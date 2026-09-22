import Foundation

/// CI stub that records scheduled background jobs (durable and in-process).
enum LucentBackground {
  private static let lock = NSLock()
  private static var jobs: [String: (version: Double, durable: Bool, payload: String)] = [:]
  private static var runCount: Double = 0

  static func schedule(
    jobId: String,
    payloadVersion: Double,
    payload: String,
    durable: Bool
  ) -> LucentBackgroundJobHandle {
    lock.lock()
    jobs[jobId] = (payloadVersion, durable, payload)
    lock.unlock()
    return LucentBackgroundJobHandle(
      jobId: jobId,
      payloadVersion: payloadVersion,
      durable: durable,
      payload: payload
    )
  }

  static func scheduledCount() -> Double {
    lock.lock()
    defer { lock.unlock() }
    return Double(jobs.count)
  }

  static func runCountValue() -> Double {
    lock.lock()
    defer { lock.unlock() }
    return runCount
  }

  static func remove(jobId: String) {
    lock.lock()
    jobs.removeValue(forKey: jobId)
    lock.unlock()
  }

  /// Run a scheduled job once. Rejects if `expectedVersion` does not match.
  static func runOnce(jobId: String, expectedVersion: Double) throws -> Double {
    lock.lock()
    defer { lock.unlock() }
    guard let job = jobs[jobId] else { throw LucentError(code: "NOT_SCHEDULED") }
    guard job.version == expectedVersion else { throw LucentError(code: "VERSION_MISMATCH") }
    runCount += 1
    return job.version
  }
}

final class LucentBackgroundJobHandle: @unchecked Sendable {
  private let lock = NSLock()
  private var isClosed = false
  private var cancelled = false
  let jobId: String
  let payloadVersion: Double
  let durable: Bool
  private let payload: String

  init(jobId: String, payloadVersion: Double, durable: Bool, payload: String) {
    self.jobId = jobId
    self.payloadVersion = payloadVersion
    self.durable = durable
    self.payload = payload
  }

  var closed: Bool {
    lock.lock()
    defer { lock.unlock() }
    return isClosed
  }

  func cancel() {
    lock.lock()
    cancelled = true
    lock.unlock()
    LucentBackground.remove(jobId: jobId)
  }

  /// Run this handle's payload once if still scheduled and version matches.
  func runOnce() throws -> Double {
    lock.lock()
    let cancelledNow = cancelled || isClosed
    let version = payloadVersion
    let id = jobId
    lock.unlock()
    guard !cancelledNow else { throw LucentError(code: "CANCELLED") }
    return try LucentBackground.runOnce(jobId: id, expectedVersion: version)
  }

  func close() async {
    await withCheckedContinuation { (continuation: CheckedContinuation<Void, Never>) in
      lock.lock()
      isClosed = true
      lock.unlock()
      continuation.resume()
    }
  }
}
