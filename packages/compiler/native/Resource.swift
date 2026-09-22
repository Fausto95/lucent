import Foundation

/// Process-wide live resource and lease counts for the Lucent resource runtime.
enum LucentResourceCounts {
  private static let lock = NSLock()
  private static var resources = 0
  private static var leases = 0

  static func adjustResources(_ delta: Int) { adjust(&resources, by: delta) }
  static func adjustLeases(_ delta: Int) { adjust(&leases, by: delta) }

  private static func adjust(_ value: inout Int, by delta: Int) {
    lock.lock()
    value += delta
    lock.unlock()
  }

  static var liveResources: Double {
    lock.lock()
    defer { lock.unlock() }
    return Double(resources)
  }

  static var liveLeases: Double {
    lock.lock()
    defer { lock.unlock() }
    return Double(leases)
  }
}

/// Development executor checks (P41). Used by adapters such as FakeUIObject.
enum LucentExecutor {
  static func requireMain() throws {
    if !Thread.isMainThread {
      throw LucentError(
        code: "EXECUTOR_ERROR",
        message: "Requires MainExecutor; current thread is not the main thread",
      )
    }
  }
}

/// Owned resource wrapper: OPEN → CLOSING → CLOSED with operation leases.
///
/// `close()` never waits synchronously on the caller that holds a lease; waiters
/// resume asynchronously so a callback that requests close cannot deadlock itself.
final class LucentResource: @unchecked Sendable {
  private enum State {
    case open
    case closing
    case closed
  }

  private let lock = NSLock()
  private var state: State = .open
  private var leases = 0
  private var closeWaiters: [CheckedContinuation<Void, Never>] = []

  /// Optional debug labels for lifetime sanitizer messages (P41).
  var createdAt: String
  var closedAt: String = ""

  init(createdAt: String = LucentResource.defaultLabel()) {
    self.createdAt = createdAt
    LucentResourceCounts.adjustResources(1)
  }

  deinit {
    LucentResourceCounts.adjustResources(-1)
  }

  private static func defaultLabel() -> String {
    ISO8601DateFormatter().string(from: Date())
  }

  var closed: Bool {
    lock.lock()
    defer { lock.unlock() }
    return state == .closed
  }

  var leaseCount: Double {
    lock.lock()
    defer { lock.unlock() }
    return Double(leases)
  }

  private func lifetimeMessage(_ action: String) -> String {
    var parts = ["Resource \(action)"]
    if !createdAt.isEmpty { parts.append("createdAt: \(createdAt)") }
    if !closedAt.isEmpty { parts.append("closedAt: \(closedAt)") }
    return parts.joined(separator: "; ")
  }

  func beginOperation() throws {
    lock.lock()
    defer { lock.unlock() }

    switch state {
    case .closed:
      throw LucentError(code: "LIFETIME_ERROR", message: lifetimeMessage("used after close"))
    case .closing:
      throw LucentError(code: "CLOSED", message: "Resource no longer accepts work")
    case .open:
      leases += 1
      LucentResourceCounts.adjustLeases(1)
    }
  }

  func endOperation() {
    lock.lock()

    if leases == 0 {
      lock.unlock()
      return
    }

    leases -= 1
    LucentResourceCounts.adjustLeases(-1)

    let shouldFinish = state == .closing && leases == 0
    lock.unlock()

    if shouldFinish { finishClose() }
  }

  /// Optional SDK cleanup hook for adapters. Must leave the resource terminal.
  func cleanup() {}

  func close() async {
    await withCheckedContinuation { (continuation: CheckedContinuation<Void, Never>) in
      lock.lock()
      switch state {
      case .closed:
        lock.unlock()
        continuation.resume()
      case .closing:
        closeWaiters.append(continuation)
        lock.unlock()
      case .open:
        state = .closing
        if leases == 0 {
          lock.unlock()
          finishClose(resuming: continuation)
        } else {
          closeWaiters.append(continuation)
          lock.unlock()
        }
      }
    }
  }

  /// Runs on the sync path that observes lease quiescence (never under `await`).
  private func finishClose(resuming immediate: CheckedContinuation<Void, Never>? = nil) {
    cleanup()

    lock.lock()
    state = .closed
    if closedAt.isEmpty { closedAt = LucentResource.defaultLabel() }
    let waiters = closeWaiters
    closeWaiters.removeAll()
    lock.unlock()

    immediate?.resume()
    for waiter in waiters { waiter.resume() }
  }
}

/// Tracks owned resources and closes them in reverse order of `own`.
final class LucentResourceBag: @unchecked Sendable {
  private let lock = NSLock()
  private var owned: [LucentResource] = []

  @discardableResult
  func own(_ resource: LucentResource) -> LucentResource {
    lock.lock()
    owned.append(resource)
    lock.unlock()
    return resource
  }

  func closeAll() async {
    lock.lock()
    let resources = owned.reversed()
    owned.removeAll()
    lock.unlock()
    for resource in resources {
      await resource.close()
    }
  }
}

/// Runs `body` then awaits `close()` on every exit path (normal and thrown).
enum LucentResourceScope {
  static func withResource(
    _ resource: LucentResource,
    _ body: (LucentResource) throws -> Void
  ) async throws {
    do {
      try body(resource)
    } catch {
      await resource.close()
      throw error
    }
    await resource.close()
  }

  /// Runs `body` with a bag that owns resources; closes them in reverse order on every exit.
  static func resourceScope(_ body: (LucentResourceBag) throws -> Void) async throws {
    let scope = LucentResourceBag()
    do {
      try body(scope)
    } catch {
      await scope.closeAll()
      throw error
    }
    await scope.closeAll()
  }
}
