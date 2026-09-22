typealias ArrayBuffer = [UInt8]
{{runtime}}
{{packages}}
{{generated}}

@main struct Runner {
  static func main() async throws {
    let counters = try makeCounters()
    let baseline = try snapshot(counters: counters)

    // 1. Close while work is in flight (barrier-controlled).
    let barrier = try makeBarrier()
    let resource = try makeResource()
    let work = Task { try await runWork(resource: resource, barrier: barrier) }
    try await awaitStarted(barrier: barrier)
    let closing = Task { try await closeResource(resource: resource) }
    while !(try resourceClosing(resource: resource)) {
      await Task.yield()
    }
    try completeBarrier(barrier: barrier)
    try await work.value
    try await closing.value
    let closedAfterWork = try resourceClosed(resource: resource)
    precondition(closedAfterWork)

    // 2. Late callback after close is discarded (returns 0).
    let lateBarrier = try makeBarrier()
    let lateResource = try makeResource()
    let scheduled = Task {
      try await schedule(
        resource: lateResource,
        barrier: lateBarrier,
        callback: { 42 }
      )
    }
    try await awaitStarted(barrier: lateBarrier)
    let lateClose = Task { try await closeResource(resource: lateResource) }
    while !(try resourceClosing(resource: lateResource)) {
      await Task.yield()
    }
    try completeBarrier(barrier: lateBarrier)
    let lateResult = try await scheduled.value
    try await lateClose.value
    precondition(lateResult == 0)
    let lateClosed = try resourceClosed(resource: lateResource)
    precondition(lateClosed)

    // 3. Sync + async callbacks with controllable completion.
    let syncValue = try callSync(callback: { 7 })
    precondition(syncValue == 7)
    let asyncBarrier = try makeBarrier()
    let asyncWork = Task { try await callAsync(barrier: asyncBarrier, callback: { 9 }) }
    try await awaitStarted(barrier: asyncBarrier)
    try completeBarrier(barrier: asyncBarrier)
    let asyncValue = try await asyncWork.value
    precondition(asyncValue == 9)

    // 4. Retained listener notify; discarded after close.
    do {
      let host = try makeResource()
      let retained = try register(
        resource: host,
        callback: { value in value + 1 },
        mode: "retained"
      )
      let notified = try notify(resource: host, value: 3)
      precondition(notified == 4)
      try await closeResource(resource: host)
      let discarded = try notify(resource: host, value: 3)
      precondition(discarded == 0)
      withExtendedLifetime(retained) {}
    }

    // 5. Subscription close quiesces in-flight deliveries.
    let source = try makeEventSource()
    let subscription = try onEvent(source: source, callback: { value in value * 2 })
    let deliveryBarrier = try makeBarrier()
    let delivery = Task {
      try await deliver(source: source, barrier: deliveryBarrier, value: 5)
    }
    try await awaitStarted(barrier: deliveryBarrier)
    let subClose = Task { try await closeSubscription(subscription: subscription) }
    while !(try subscriptionClosing(subscription: subscription)) {
      await Task.yield()
    }
    try completeBarrier(barrier: deliveryBarrier)
    let deliveryValue = try await delivery.value
    precondition(deliveryValue == 10)
    try await subClose.value
    let subClosed = try subscriptionClosed(subscription: subscription)
    precondition(subClosed)
    let afterClose = try await deliver(source: source, barrier: try makeBarrier(), value: 1)
    precondition(afterClose == 0)
    try await closeEventSource(source: source)

    // 6. Counters return to baseline after quiescence.
    let after = try snapshot(counters: counters)
    precondition(after.leases == baseline.leases)
    precondition(after.callbacks == baseline.callbacks)
    precondition(after.subscriptions == baseline.subscriptions)
    precondition(after.delegates == baseline.delegates)

    print("swift: fake-sdk barrier close, late discard, callback control, subscription quiescence passed")
  }
}
