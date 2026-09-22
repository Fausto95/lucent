import Foundation

/// Process-wide BLE resource counts for CI fake peripherals.
enum LucentBluetoothCounts {
  private static let lock = NSLock()
  private static var scanners = 0
  private static var connections = 0

  static func adjustScanners(_ delta: Int) {
    lock.lock()
    scanners += delta
    lock.unlock()
  }

  static func adjustConnections(_ delta: Int) {
    lock.lock()
    connections += delta
    lock.unlock()
  }

  static var liveScanners: Double {
    lock.lock()
    defer { lock.unlock() }
    return Double(scanners)
  }

  static var liveConnections: Double {
    lock.lock()
    defer { lock.unlock() }
    return Double(connections)
  }
}

/// Package policy: notification buffer capacity (buffer(n)).
let LucentBluetoothNotificationCapacity = 32

/// CI BLE scanner stub with a scan-results queue and fake peripherals (`fake-1`, …).
final class LucentBluetoothScanner: @unchecked Sendable {
  private enum State { case idle, scanning, closed }
  private let lock = NSLock()
  private var state: State = .idle
  private var scanResults: [String] = []

  init() {
    LucentBluetoothCounts.adjustScanners(1)
  }

  var closed: Bool {
    lock.lock()
    defer { lock.unlock() }
    return state == .closed
  }

  func start() throws {
    lock.lock()
    defer { lock.unlock() }
    guard state != .closed else { throw LucentError(code: "CLOSED") }
    state = .scanning
  }

  func stop() {
    lock.lock()
    defer { lock.unlock() }
    guard state != .closed else { return }
    state = .idle
  }

  /// CI-only: enqueue a discovered peripheral id while scanning.
  func enqueueScanResult(peripheralId: String) throws {
    lock.lock()
    defer { lock.unlock() }
    guard state == .scanning else { throw LucentError(code: "NOT_SCANNING") }
    scanResults.append(peripheralId)
  }

  /// Pop the oldest scan result, or empty string when the queue is empty.
  func pollScanResult() throws -> String {
    lock.lock()
    defer { lock.unlock() }
    guard state != .closed else { throw LucentError(code: "CLOSED") }
    if scanResults.isEmpty { return "" }
    return scanResults.removeFirst()
  }

  func connect(peripheralId: String) async throws -> LucentBluetoothConnection {
    lock.lock()
    let ok = state == .scanning
    lock.unlock()
    guard ok else { throw LucentError(code: "NOT_SCANNING") }
    guard peripheralId.hasPrefix("fake-") else { throw LucentError(code: "UNKNOWN_PERIPHERAL") }
    return LucentBluetoothConnection(peripheralId: peripheralId)
  }

  func close() async {
    await withCheckedContinuation { (continuation: CheckedContinuation<Void, Never>) in
      lock.lock()
      let release = state != .closed
      if release {
        state = .closed
        scanResults.removeAll()
      }
      lock.unlock()
      if release { LucentBluetoothCounts.adjustScanners(-1) }
      continuation.resume()
    }
  }
}

/// CI BLE connection stub with a connection state machine and bounded notification buffer.
final class LucentBluetoothConnection: @unchecked Sendable {
  private enum ConnState { case connecting, connected, disconnecting, disconnected }

  private let lock = NSLock()
  private var connState: ConnState = .connecting
  private let peripheralId: String
  private var storage: [String: [UInt8]] = [:]
  private var notificationCallback: ((ArrayBuffer) throws -> Double)?
  private var notificationCharacteristic: String?
  private var pendingNotifications = 0

  init(peripheralId: String) {
    self.peripheralId = peripheralId
    LucentBluetoothCounts.adjustConnections(1)
    connState = .connected
  }

  var closed: Bool {
    lock.lock()
    defer { lock.unlock() }
    return connState == .disconnected
  }

  var connectionState: String {
    lock.lock()
    defer { lock.unlock() }
    switch connState {
    case .connecting: return "connecting"
    case .connected: return "connected"
    case .disconnecting: return "disconnecting"
    case .disconnected: return "disconnected"
    }
  }

  func read(characteristic: String) async throws -> ArrayBuffer {
    lock.lock()
    defer { lock.unlock() }
    guard connState == .connected else { throw LucentError(code: "CLOSED") }
    let bytes = storage[characteristic] ?? [UInt8](peripheralId.utf8)
    return try LucentBytes.fromData(Data(bytes))
  }

  func write(characteristic: String, payload: ArrayBuffer) async throws {
    lock.lock()
    defer { lock.unlock() }
    guard connState == .connected else { throw LucentError(code: "CLOSED") }
    storage[characteristic] = [UInt8](LucentBytes.data(payload))
  }

  /// Package policy buffer(n=32) with `backpressure: "block"`; overflow throws.
  func notifications(
    characteristic: String,
    callback: @escaping (ArrayBuffer) throws -> Double
  ) throws -> Double {
    lock.lock()
    defer { lock.unlock() }
    guard connState == .connected else { throw LucentError(code: "CLOSED") }
    notificationCharacteristic = characteristic
    notificationCallback = callback
    pendingNotifications = 0
    return 1
  }

  func deliverNotification(characteristic: String, payload: ArrayBuffer) throws -> Double {
    lock.lock()
    guard connState == .connected else {
      lock.unlock()
      throw LucentError(code: "CLOSED")
    }
    guard notificationCharacteristic == characteristic, let callback = notificationCallback else {
      lock.unlock()
      throw LucentError(code: "NO_CALLBACK")
    }
    if pendingNotifications >= LucentBluetoothNotificationCapacity {
      lock.unlock()
      throw LucentError(code: "BUFFER_OVERFLOW")
    }
    pendingNotifications += 1
    lock.unlock()
    defer {
      lock.lock()
      pendingNotifications -= 1
      lock.unlock()
    }
    return try callback(payload)
  }

  func close() async {
    await withCheckedContinuation { (continuation: CheckedContinuation<Void, Never>) in
      lock.lock()
      let release = connState != .disconnected
      if release {
        connState = .disconnecting
        notificationCallback = nil
        pendingNotifications = 0
        connState = .disconnected
      }
      lock.unlock()
      if release { LucentBluetoothCounts.adjustConnections(-1) }
      continuation.resume()
    }
  }
}
