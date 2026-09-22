import Foundation

enum LucentLocationCounts {
  private static let lock = NSLock()
  private static var providers = 0

  static func adjustProviders(_ delta: Int) {
    lock.lock()
    providers += delta
    lock.unlock()
  }

  static var liveProviders: Double {
    lock.lock()
    defer { lock.unlock() }
    return Double(providers)
  }
}

/// Owned position value — may be retained after the updates callback returns.
final class LucentPosition: @unchecked Sendable {
  let latitude: Double
  let longitude: Double
  let accuracy: Double
  let timestamp: Double

  init(latitude: Double, longitude: Double, accuracy: Double, timestamp: Double) {
    self.latitude = latitude
    self.longitude = longitude
    self.accuracy = accuracy
    self.timestamp = timestamp
  }
}

/// CI location provider stub. Keep-latest backpressure; stale/duplicate drops.
final class LucentLocationProvider: @unchecked Sendable {
  private let lock = NSLock()
  private var isClosed = false
  private var updatesCallback: ((LucentPosition) throws -> Double)?
  private var lastDelivered: LucentPosition?
  private var droppedStale: Double = 0
  private var droppedDuplicate: Double = 0

  init() {
    LucentLocationCounts.adjustProviders(1)
  }

  var closed: Bool {
    lock.lock()
    defer { lock.unlock() }
    return isClosed
  }

  func staleDrops() -> Double {
    lock.lock()
    defer { lock.unlock() }
    return droppedStale
  }

  func duplicateDrops() -> Double {
    lock.lock()
    defer { lock.unlock() }
    return droppedDuplicate
  }

  func updates(_ callback: @escaping (LucentPosition) throws -> Double) throws -> Double {
    lock.lock()
    defer { lock.unlock() }
    guard !isClosed else { throw LucentError(code: "CLOSED") }
    updatesCallback = callback
    return 1
  }

  /// Deliver a fake fix. Stale (older timestamp) and exact duplicates are dropped.
  func deliverFake(latitude: Double, longitude: Double, accuracy: Double, timestamp: Double) throws -> Double {
    lock.lock()
    guard !isClosed else {
      lock.unlock()
      throw LucentError(code: "CLOSED")
    }
    guard LucentLocation.permission == "granted" else {
      lock.unlock()
      throw LucentError(code: "PERMISSION_DENIED")
    }
    guard let callback = updatesCallback else {
      lock.unlock()
      throw LucentError(code: "NO_CALLBACK")
    }
    if let last = lastDelivered {
      if timestamp < last.timestamp {
        droppedStale += 1
        lock.unlock()
        return 0
      }
      if timestamp == last.timestamp,
         latitude == last.latitude,
         longitude == last.longitude {
        droppedDuplicate += 1
        lock.unlock()
        return 0
      }
    }
    let position = LucentPosition(
      latitude: latitude,
      longitude: longitude,
      accuracy: accuracy,
      timestamp: timestamp
    )
    lastDelivered = position
    lock.unlock()
    return try callback(position)
  }

  func close() async {
    await withCheckedContinuation { (continuation: CheckedContinuation<Void, Never>) in
      lock.lock()
      let release = !isClosed
      if release {
        isClosed = true
        updatesCallback = nil
      }
      lock.unlock()
      if release { LucentLocationCounts.adjustProviders(-1) }
      continuation.resume()
    }
  }
}

enum LucentLocation {
  private static let lock = NSLock()
  static var permission = "granted"

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

  /// CI-only: change permission union state (affects subsequent deliveries).
  static func setPermission(_ state: String) {
    lock.lock()
    permission = state
    lock.unlock()
  }
}
