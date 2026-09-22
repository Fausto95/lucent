import Foundation

// Every access to the cancellation bit is synchronized; no SDK objects are transferred.
final class LucentCancellationSource: @unchecked Sendable {
  private let lock = NSLock()
  private var requested = false
  private var completed = false
  private var children: [LucentCancellationSource] = []

  var cancelled: Bool {
    lock.lock()
    defer { lock.unlock() }
    return requested
  }

  func cancel() {
    lock.lock()
    requested = true
    let kids = children
    lock.unlock()

    for child in kids { child.cancel() }
  }

  func throwIfCancelled() throws {
    if cancelled {
      throw LucentError(code: "CANCELLED", message: "Native operation was cancelled")
    }
  }

  func scope() -> LucentCancellationSource {
    let child = LucentCancellationSource()

    lock.lock()
    children.append(child)
    let already = requested
    lock.unlock()

    if already { child.cancel() }
    return child
  }

  func finish() -> Bool {
    lock.lock()
    defer { lock.unlock() }

    if requested || completed { return false }
    completed = true
    return true
  }
}
