import Foundation

fileprivate final class LucentTaskRecord {
  var cancelled = false
  var finished = false
}

fileprivate protocol LucentTaskHost: AnyObject {
  func hostCancelled(_ record: LucentTaskRecord) -> Bool
  func hostFinished(_ record: LucentTaskRecord) -> Bool
  func hostCancel(_ record: LucentTaskRecord)
  func hostFinish(_ record: LucentTaskRecord) -> Bool
  func hostFail(_ record: LucentTaskRecord, error: Error)
}

// Every mutable field is protected by the owning scope lock.
final class LucentTaskScope: @unchecked Sendable {
  private let lock = NSLock()
  private var stopping = false
  private var records: [ObjectIdentifier: LucentTaskRecord] = [:]
  private var waiters: [CheckedContinuation<Void, Never>] = []

  var closing: Bool {
    lock.lock()
    defer { lock.unlock() }
    return stopping
  }

  var activeCount: Double {
    lock.lock()
    defer { lock.unlock() }
    return Double(records.count)
  }

  func begin() throws -> LucentTask {
    lock.lock()
    defer { lock.unlock() }

    if stopping {
      throw LucentError(code: "CLOSED_SCOPE", message: "Task scope no longer accepts work")
    }

    let record = LucentTaskRecord()
    records[ObjectIdentifier(record)] = record
    return LucentTask(host: self, record: record)
  }

  func close() async {
    await withCheckedContinuation { continuation in
      lock.lock()
      stopping = true
      for record in records.values { record.cancelled = true }

      let ready = records.isEmpty
      if !ready { waiters.append(continuation) }
      lock.unlock()

      if ready { continuation.resume() }
    }
  }

  fileprivate func cancelled(_ record: LucentTaskRecord) -> Bool {
    lock.lock()
    defer { lock.unlock() }
    return record.cancelled
  }

  fileprivate func finished(_ record: LucentTaskRecord) -> Bool {
    lock.lock()
    defer { lock.unlock() }
    return record.finished
  }

  fileprivate func cancel(_ record: LucentTaskRecord) {
    lock.lock()
    defer { lock.unlock() }

    if !record.finished { record.cancelled = true }
  }

  fileprivate func finish(_ record: LucentTaskRecord) -> Bool {
    lock.lock()

    if record.finished {
      lock.unlock()
      return false
    }

    record.finished = true
    let accepted = !record.cancelled
    records.removeValue(forKey: ObjectIdentifier(record))

    let ready = stopping && records.isEmpty ? waiters : []
    if stopping && records.isEmpty { waiters.removeAll() }
    lock.unlock()

    for waiter in ready { waiter.resume() }
    return accepted
  }
}

extension LucentTaskScope: LucentTaskHost {
  fileprivate func hostCancelled(_ record: LucentTaskRecord) -> Bool { cancelled(record) }
  fileprivate func hostFinished(_ record: LucentTaskRecord) -> Bool { finished(record) }
  fileprivate func hostCancel(_ record: LucentTaskRecord) { cancel(record) }
  fileprivate func hostFinish(_ record: LucentTaskRecord) -> Bool { finish(record) }

  fileprivate func hostFail(_ record: LucentTaskRecord, error: Error) {
    _ = error
    cancel(record)
    _ = finish(record)
  }
}

/// Structured task group: first child failure cancels siblings; `close` awaits
/// quiescence and rethrows the primary error.
final class LucentTaskGroup: @unchecked Sendable {
  private let lock = NSLock()
  private var stopping = false
  private var records: [ObjectIdentifier: LucentTaskRecord] = [:]
  private var waiters: [CheckedContinuation<Void, Never>] = []
  private var primaryError: Error?

  var closing: Bool {
    lock.lock()
    defer { lock.unlock() }
    return stopping
  }

  var activeCount: Double {
    lock.lock()
    defer { lock.unlock() }
    return Double(records.count)
  }

  func begin() throws -> LucentTask {
    lock.lock()
    defer { lock.unlock() }

    if stopping {
      throw LucentError(code: "CLOSED_SCOPE", message: "Task group no longer accepts work")
    }

    let record = LucentTaskRecord()
    records[ObjectIdentifier(record)] = record
    return LucentTask(host: self, record: record)
  }

  /// Spawn async child work. On throw, cancel siblings and record the primary error.
  func run(_ body: @escaping @Sendable () async throws -> Void) throws {
    let child = try begin()
    Task {
      do {
        try await body()
        _ = child.finish()
      } catch {
        child.fail(error)
      }
    }
  }

  func close() async throws {
    await withCheckedContinuation { (continuation: CheckedContinuation<Void, Never>) in
      lock.lock()
      stopping = true
      for record in records.values { record.cancelled = true }

      let ready = records.isEmpty
      if !ready { waiters.append(continuation) }
      lock.unlock()

      if ready { continuation.resume() }
    }

    lock.lock()
    let error = primaryError
    lock.unlock()
    if let error { throw error }
  }

  fileprivate func cancelled(_ record: LucentTaskRecord) -> Bool {
    lock.lock()
    defer { lock.unlock() }
    return record.cancelled
  }

  fileprivate func finished(_ record: LucentTaskRecord) -> Bool {
    lock.lock()
    defer { lock.unlock() }
    return record.finished
  }

  fileprivate func cancel(_ record: LucentTaskRecord) {
    lock.lock()
    defer { lock.unlock() }

    if !record.finished { record.cancelled = true }
  }

  fileprivate func finish(_ record: LucentTaskRecord) -> Bool {
    lock.lock()

    if record.finished {
      lock.unlock()
      return false
    }

    record.finished = true
    let accepted = !record.cancelled
    records.removeValue(forKey: ObjectIdentifier(record))

    let ready = stopping && records.isEmpty ? waiters : []
    if stopping && records.isEmpty { waiters.removeAll() }
    lock.unlock()

    for waiter in ready { waiter.resume() }
    return accepted
  }

  fileprivate func fail(_ record: LucentTaskRecord, error: Error) {
    lock.lock()
    if primaryError == nil { primaryError = error }
    for other in records.values where ObjectIdentifier(other) != ObjectIdentifier(record) {
      if !other.finished { other.cancelled = true }
    }
    lock.unlock()

    _ = finish(record)
  }
}

extension LucentTaskGroup: LucentTaskHost {
  fileprivate func hostCancelled(_ record: LucentTaskRecord) -> Bool { cancelled(record) }
  fileprivate func hostFinished(_ record: LucentTaskRecord) -> Bool { finished(record) }
  fileprivate func hostCancel(_ record: LucentTaskRecord) { cancel(record) }
  fileprivate func hostFinish(_ record: LucentTaskRecord) -> Bool { finish(record) }
  fileprivate func hostFail(_ record: LucentTaskRecord, error: Error) { fail(record, error: error) }
}

final class LucentTask: @unchecked Sendable {
  private let host: LucentTaskHost
  private let record: LucentTaskRecord

  fileprivate init(host: LucentTaskHost, record: LucentTaskRecord) {
    self.host = host
    self.record = record
  }

  var cancelled: Bool { host.hostCancelled(record) }
  var finished: Bool { host.hostFinished(record) }

  func cancel() { host.hostCancel(record) }
  func finish() -> Bool { host.hostFinish(record) }

  /// Record failure: for a task group, cancels siblings and stores the primary error.
  func fail(_ error: Error) { host.hostFail(record, error: error) }

  func throwIfCancelled() throws {
    if cancelled {
      throw LucentError(code: "CANCELLED", message: "Native task was cancelled")
    }
  }
}

/// Runs an async component effect under a TaskScope: cancel/join previous work,
/// then await cleanup, before the next generation or unmount completes.
enum LucentEffectRunner {
  static func run(
    setup: @escaping @Sendable () async throws -> Void,
    cleanup: @escaping @Sendable () async throws -> Void
  ) async {
    let scope = LucentTaskScope()
    let child = try? scope.begin()
    do {
      try await setup()
      try await withTaskCancellationHandler {
        try await Task.sleep(nanoseconds: UInt64.max)
      } onCancel: {
        child?.cancel()
      }
    } catch {
      // Cancellation or setup failure — still run cleanup and join the scope.
    }
    do {
      try await cleanup()
    } catch {}
    _ = child?.finish()
    await scope.close()
  }
}
