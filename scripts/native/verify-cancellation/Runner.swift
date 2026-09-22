typealias ArrayBuffer = [UInt8]
{{runtime}}
{{packages}}
{{generated}}

@main struct Runner {
  static func main() throws {
    let source = try make()
    let initial = try checkpoint(source: source)
    precondition(!initial)
    DispatchQueue.concurrentPerform(iterations: 1000) { _ in try! cancel(source: source) }
    do { _ = try checkpoint(source: source); fatalError("Cancellation was ignored") } catch let error as LucentError { precondition(error.code == "CANCELLED") }
    try cancel(source: source)
    let parent = try make()
    let scoped = try child(source: parent)
    try cancel(source: parent)
    do { _ = try checkpoint(source: scoped); fatalError("Child scope ignored cancellation") } catch let error as LucentError { precondition(error.code == "CANCELLED") }
    let finished = try make()
    let first = try complete(source: finished)
    let second = try complete(source: finished)
    precondition(first)
    precondition(!second)
    let cancelled = try make()
    try cancel(source: cancelled)
    let afterCancel = try complete(source: cancelled)
    precondition(!afterCancel)
    print("swift: cooperative cancellation, typed errors and concurrent cancellation passed")
  }
}
