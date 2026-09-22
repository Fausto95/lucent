import Foundation

final class LucentEventHub: @unchecked Sendable {
  static let shared = LucentEventHub()

  private let lock = NSLock()
  private var next = 0
  private var listeners: [Int: (String, (String) -> Void)] = [:]

  func subscribe(_ event: String, _ callback: @escaping (String) -> Void) -> Int {
    lock.lock()
    defer { lock.unlock() }

    next += 1
    listeners[next] = (event, callback)
    return next
  }

  func remove(_ token: Int) {
    lock.lock()
    defer { lock.unlock() }

    listeners.removeValue(forKey: token)
  }

  func emit(_ event: String, _ payload: Any) throws {
    let data = try JSONSerialization.data(withJSONObject: payload, options: [.fragmentsAllowed, .sortedKeys])
    let json = String(decoding: data, as: UTF8.self)

    lock.lock()
    let callbacks = listeners.values.filter { $0.0 == event }.map { $0.1 }
    lock.unlock()

    callbacks.forEach { $0(json) }
  }
}
