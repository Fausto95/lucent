import Foundation

fileprivate final class LucentTaskRecord {
  var cancelled = false
  var finished = false
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
    return LucentTask(scope: self, record: record)
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

final class LucentTask: @unchecked Sendable {
  private let scope: LucentTaskScope
  private let record: LucentTaskRecord

  fileprivate init(scope: LucentTaskScope, record: LucentTaskRecord) {
    self.scope = scope
    self.record = record
  }

  var cancelled: Bool { scope.cancelled(record) }
  var finished: Bool { scope.finished(record) }

  func cancel() { scope.cancel(record) }
  func finish() -> Bool { scope.finish(record) }

  func throwIfCancelled() throws {
    if cancelled {
      throw LucentError(code: "CANCELLED", message: "Native task was cancelled")
    }
  }
}
