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
    let before = LucentResourceCounts.liveResources
    let resource = try make()
    precondition(LucentResourceCounts.liveResources == before + 1)
    try begin(resource: resource)
    precondition(resource.leaseCount == 1 && LucentResourceCounts.liveLeases == 1)
    let completed = Counter()
    let closes = (0..<8).map { _ in Task { try await close(resource: resource); completed.increment() } }
    while true {
      do {
        try resource.beginOperation()
        resource.endOperation()
        await Task.yield()
      } catch let error as LucentError {
        precondition(error.code == "CLOSED")
        break
      }
    }
    precondition(completed.value == 0 && resource.leaseCount == 1 && !resource.closed)
    try end(resource: resource)
    for pending in closes { try await pending.value }
    precondition(completed.value == 8 && resource.closed && resource.leaseCount == 0)
    precondition(LucentResourceCounts.liveLeases == 0)
    await resource.close()
    do { try resource.beginOperation(); fatalError("accepted closed resource") } catch let error as LucentError {
      precondition(error.code == "LIFETIME_ERROR")
      precondition(error.message.contains("createdAt") || resource.createdAt.isEmpty)
    }
    let again = try make()
    try begin(resource: again)
    let reentrant = Counter()
    let pendingClose = Task {
      try await close(resource: again)
      reentrant.increment()
    }
    while true {
      do {
        try again.beginOperation()
        again.endOperation()
        await Task.yield()
      } catch { break }
    }
    precondition(reentrant.value == 0)
    try end(resource: again)
    try await pendingClose.value
    precondition(reentrant.value == 1 && again.closed)
    print("swift: resource lease quiescence, concurrent close and reentrant wait passed")
  }
}
