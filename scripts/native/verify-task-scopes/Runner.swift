typealias ArrayBuffer = [UInt8]
{{runtime}}
{{packages}}
{{generated}}

final class Counter: @unchecked Sendable {
  private let lock = NSLock()
  private var count = 0
  func increment() { lock.lock(); count += 1; lock.unlock() }
  var value: Int { lock.lock(); defer { lock.unlock() }; return count }
}
@main struct Runner {
  static func main() async throws {
    let scope = try make()
    let first = try begin(scope: scope), second = try begin(scope: scope)
    let completed = Counter()
    let closes = (0..<8).map { _ in Task { try await close(scope: scope); completed.increment() } }
    while !scope.closing { await Task.yield() }
    precondition(first.cancelled && second.cancelled && scope.activeCount == 2)
    precondition(completed.value == 0)
    do { _ = try scope.begin(); fatalError("accepted closed scope") } catch let error as LucentError { precondition(error.code == "CLOSED_SCOPE") }
    do { try first.throwIfCancelled(); fatalError("ignored cancellation") } catch let error as LucentError { precondition(error.code == "CANCELLED") }
    precondition(!first.finish() && first.finished && scope.activeCount == 1)
    precondition(completed.value == 0)
    precondition(!second.finish())
    for pending in closes { try await pending.value }
    precondition(completed.value == 8 && scope.activeCount == 0)
    await scope.close()
    precondition(!first.finish())
    let successScope = try make(), successes = Counter()
    let success = try successScope.begin()
    DispatchQueue.concurrentPerform(iterations: 1000) { _ in if success.finish() { successes.increment() } }
    precondition(successes.value == 1 && successScope.activeCount == 0)
    success.cancel()
    precondition(!success.cancelled && success.finished)
    await successScope.close()
    for _ in 0..<100 {
      let racingScope = LucentTaskScope(), accepted = Counter()
      let racing = try racingScope.begin()
      DispatchQueue.concurrentPerform(iterations: 2) { index in
        if index == 0 { racing.cancel() } else if racing.finish() { accepted.increment() }
      }
      precondition(racing.finished && racingScope.activeCount == 0)
      precondition(accepted.value == (racing.cancelled ? 0 : 1))
      await racingScope.close()
    }
    print("swift: task quiescence, concurrent completion and repeated close passed")
  }
}
