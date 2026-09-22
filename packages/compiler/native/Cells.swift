import Foundation

/// Explicit mutable capture cell. Does not make concurrent mutation safe.
final class LucentCell: @unchecked Sendable {
  private let lock = NSLock()
  private var stored: Double

  init(_ initial: Double) {
    stored = initial
  }

  var value: Double {
    get {
      lock.lock()
      defer { lock.unlock() }
      return stored
    }
    set {
      lock.lock()
      stored = newValue
      lock.unlock()
    }
  }
}
