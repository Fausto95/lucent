import Foundation

/// Process-wide live subscription and in-flight delivery counts.
enum LucentSubscriptionCounts {
  private static let lock = NSLock()
  private static var subscriptions = 0
  private static var deliveries = 0

  static func adjustSubscriptions(_ delta: Int) { adjust(&subscriptions, by: delta) }
  static func adjustDeliveries(_ delta: Int) { adjust(&deliveries, by: delta) }

  private static func adjust(_ value: inout Int, by delta: Int) {
    lock.lock()
    value += delta
    lock.unlock()
  }

  static var liveSubscriptions: Double {
    lock.lock()
    defer { lock.unlock() }
    return Double(subscriptions)
  }

  static var liveDeliveries: Double {
    lock.lock()
    defer { lock.unlock() }
    return Double(deliveries)
  }
}

/// Owned subscription: OPEN → CLOSING → CLOSED with in-flight delivery leases.
///
/// `beginDelivery` / `endDelivery` track active callbacks. `close()` waits until
/// every delivery completes before finishing teardown, using async continuations
/// so a callback that requests close cannot deadlock itself.
final class LucentSubscription: @unchecked Sendable {
  private enum State {
    case open
    case closing
    case closed
  }

  private let lock = NSLock()
  private var state: State = .open
  private var activeCallbacks = 0
  private var closeWaiters: [CheckedContinuation<Void, Never>] = []

  /// Optional debug labels for lifetime sanitizer messages (P41).
  var createdAt: String
  var closedAt: String = ""

  init(createdAt: String = LucentSubscription.defaultLabel()) {
    self.createdAt = createdAt
    LucentSubscriptionCounts.adjustSubscriptions(1)
  }

  deinit {
    LucentSubscriptionCounts.adjustSubscriptions(-1)
  }

  private static func defaultLabel() -> String {
    ISO8601DateFormatter().string(from: Date())
  }

  var closed: Bool {
    lock.lock()
    defer { lock.unlock() }
    return state == .closed
  }

  var activeCallbackCount: Double {
    lock.lock()
    defer { lock.unlock() }
    return Double(activeCallbacks)
  }

  private func lifetimeMessage(_ action: String) -> String {
    var parts = ["Subscription \(action)"]
    if !createdAt.isEmpty { parts.append("createdAt: \(createdAt)") }
    if !closedAt.isEmpty { parts.append("closedAt: \(closedAt)") }
    return parts.joined(separator: "; ")
  }

  func beginDelivery() throws {
    lock.lock()
    defer { lock.unlock() }

    switch state {
    case .closed:
      throw LucentError(code: "LIFETIME_ERROR", message: lifetimeMessage("used after close"))
    case .closing:
      throw LucentError(code: "CLOSED", message: "Subscription no longer accepts delivery")
    case .open:
      activeCallbacks += 1
      LucentSubscriptionCounts.adjustDeliveries(1)
    }
  }

  func endDelivery() {
    lock.lock()

    if activeCallbacks == 0 {
      lock.unlock()
      return
    }

    activeCallbacks -= 1
    LucentSubscriptionCounts.adjustDeliveries(-1)

    let shouldFinish = state == .closing && activeCallbacks == 0
    lock.unlock()

    if shouldFinish { finishClose() }
  }

  /// Optional SDK cleanup hook (deregister listeners). Must leave the subscription terminal.
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
        if activeCallbacks == 0 {
          lock.unlock()
          finishClose(resuming: continuation)
        } else {
          closeWaiters.append(continuation)
          lock.unlock()
        }
      }
    }
  }

  private func finishClose(resuming immediate: CheckedContinuation<Void, Never>? = nil) {
    cleanup()

    lock.lock()
    state = .closed
    if closedAt.isEmpty { closedAt = LucentSubscription.defaultLabel() }
    let waiters = closeWaiters
    closeWaiters.removeAll()
    lock.unlock()

    immediate?.resume()
    for waiter in waiters { waiter.resume() }
  }
}

/// Runs `body` then awaits `close()` on every exit path (normal and thrown).
enum LucentSubscriptionScope {
  static func withSubscription(
    _ subscription: LucentSubscription,
    _ body: (LucentSubscription) throws -> Void
  ) async throws {
    do {
      try body(subscription)
    } catch {
      await subscription.close()
      throw error
    }
    await subscription.close()
  }
}
