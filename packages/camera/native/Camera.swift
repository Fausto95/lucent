import Foundation

/// Process-wide open camera session / frame counts for CI stubs (no physical camera).
enum LucentCameraCounts {
  private static let lock = NSLock()
  private static var sessions = 0
  private static var frames = 0

  static func adjustSessions(_ delta: Int) {
    lock.lock()
    sessions += delta
    lock.unlock()
  }

  static func adjustFrames(_ delta: Int) {
    lock.lock()
    frames += delta
    lock.unlock()
  }

  static var liveSessions: Double {
    lock.lock()
    defer { lock.unlock() }
    return Double(sessions)
  }

  static var liveFrames: Double {
    lock.lock()
    defer { lock.unlock() }
    return Double(frames)
  }
}

/// Synthetic camera frame buffer owned by the producer for the callback duration.
/// Keep-latest backpressure is package policy; this stub delivers synchronously
/// and counts drops when a delivery arrives while another is in flight or while
/// the session is interrupted.
final class LucentCameraFrame: @unchecked Sendable {
  let width: Double
  let height: Double
  let rowStride: Double
  let pixelStride: Double
  private let bytes: [UInt8]
  private var valid = true

  init(bytes: [UInt8], width: Double, height: Double, rowStride: Double, pixelStride: Double) {
    self.bytes = bytes
    self.width = width
    self.height = height
    self.rowStride = rowStride
    self.pixelStride = pixelStride
    LucentCameraCounts.adjustFrames(1)
  }

  func sample(_ index: Double) throws -> Double {
    guard valid else { throw LucentError(code: "CLOSED_FRAME") }
    guard index >= 0, index < Double(bytes.count), index.rounded(.down) == index else {
      throw LucentError(code: "INVALID_FRAME")
    }
    return Double(bytes[Int(index)])
  }

  func close() {
    guard valid else { return }
    valid = false
    LucentCameraCounts.adjustFrames(-1)
  }
}

/// CI camera session stub. Lucent owns start/stop/close/interrupt/restart orchestration.
final class LucentCameraSession: @unchecked Sendable {
  private enum State {
    case idle
    case running
    case interrupted
    case closed
  }

  private let lock = NSLock()
  private var state: State = .idle
  private var interruptionReason = "none"
  private var framesCallback: ((LucentCameraFrame) throws -> Double)?
  private var delivering = false
  private var dropCount: Double = 0

  init() {
    LucentCameraCounts.adjustSessions(1)
  }

  var closed: Bool {
    lock.lock()
    defer { lock.unlock() }
    return state == .closed
  }

  var interrupted: Bool {
    lock.lock()
    defer { lock.unlock() }
    return state == .interrupted
  }

  var interruptionReasonValue: String {
    lock.lock()
    defer { lock.unlock() }
    return interruptionReason
  }

  func droppedFrames() -> Double {
    lock.lock()
    defer { lock.unlock() }
    return dropCount
  }

  func resetDropCounter() {
    lock.lock()
    defer { lock.unlock() }
    dropCount = 0
  }

  func start() throws {
    lock.lock()
    defer { lock.unlock() }
    guard state != .closed else { throw LucentError(code: "CLOSED") }
    state = .running
    interruptionReason = "none"
  }

  func stop() {
    lock.lock()
    defer { lock.unlock() }
    guard state != .closed else { return }
    state = .idle
    interruptionReason = "none"
  }

  /// Stub interruption (audio / system / background). Contract-tested in CI.
  func interrupt(reason: String) throws {
    lock.lock()
    defer { lock.unlock() }
    guard state != .closed else { throw LucentError(code: "CLOSED") }
    guard state == .running || state == .interrupted else { throw LucentError(code: "NOT_RUNNING") }
    state = .interrupted
    interruptionReason = reason
  }

  /// Clear interruption and return to running.
  func restart() throws {
    lock.lock()
    defer { lock.unlock() }
    guard state != .closed else { throw LucentError(code: "CLOSED") }
    guard state == .interrupted || state == .running else { throw LucentError(code: "NOT_RUNNING") }
    state = .running
    interruptionReason = "none"
  }

  /// Retain `callback` for the subscription lifetime. Package policy is
  /// backpressure "latest" (worker executor, notify errors).
  func frames(_ callback: @escaping (LucentCameraFrame) throws -> Double) throws -> Double {
    lock.lock()
    defer { lock.unlock() }
    guard state != .closed else { throw LucentError(code: "CLOSED") }
    framesCallback = callback
    return 1
  }

  /// Deliver one synthetic frame. Keep-latest: if a delivery is already in
  /// flight or the session is interrupted, increment the drop counter and skip.
  func deliverSynthetic(
    bytes: [UInt8],
    width: Double,
    height: Double,
    rowStride: Double,
    pixelStride: Double
  ) throws -> Double {
    lock.lock()
    if state == .interrupted {
      dropCount += 1
      lock.unlock()
      return 0
    }
    guard state == .running else {
      lock.unlock()
      throw LucentError(code: "NOT_RUNNING")
    }
    if delivering {
      dropCount += 1
      lock.unlock()
      return 0
    }
    guard let callback = framesCallback else {
      lock.unlock()
      throw LucentError(code: "NO_CALLBACK")
    }
    delivering = true
    lock.unlock()
    let frame = LucentCameraFrame(
      bytes: bytes,
      width: width,
      height: height,
      rowStride: rowStride,
      pixelStride: pixelStride
    )
    defer {
      frame.close()
      lock.lock()
      delivering = false
      lock.unlock()
    }
    return try callback(frame)
  }

  func close() async {
    await withCheckedContinuation { (continuation: CheckedContinuation<Void, Never>) in
      lock.lock()
      let release = state != .closed
      if release {
        state = .closed
        framesCallback = nil
        interruptionReason = "none"
      }
      lock.unlock()
      if release { LucentCameraCounts.adjustSessions(-1) }
      continuation.resume()
    }
  }
}

enum LucentCamera {
  private static let lock = NSLock()
  private static var permission = "granted"

  static func requestPermission() -> String {
    lock.lock()
    defer { lock.unlock() }
    return permission
  }

  static func permissionState() -> String {
    lock.lock()
    defer { lock.unlock() }
    return permission
  }

  /// CI-only: set the stub permission union state.
  static func setPermission(_ state: String) {
    lock.lock()
    permission = state
    lock.unlock()
  }
}
