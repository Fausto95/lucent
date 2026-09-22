import Foundation

/// Process-wide live-object counts for the fake SDK.
enum FakeLiveCounts {
  private static let lock = NSLock()
  private static var handles = 0
  private static var resources = 0
  private static var leases = 0
  private static var delegates = 0
  private static var callbacks = 0
  private static var tasks = 0
  private static var buffers = 0
  private static var subscriptions = 0

  static func adjustHandles(_ delta: Int) { adjust(&handles, by: delta) }
  static func adjustResources(_ delta: Int) { adjust(&resources, by: delta) }
  static func adjustLeases(_ delta: Int) { adjust(&leases, by: delta) }
  static func adjustDelegates(_ delta: Int) { adjust(&delegates, by: delta) }
  static func adjustCallbacks(_ delta: Int) { adjust(&callbacks, by: delta) }
  static func adjustTasks(_ delta: Int) { adjust(&tasks, by: delta) }
  static func adjustBuffers(_ delta: Int) { adjust(&buffers, by: delta) }
  static func adjustSubscriptions(_ delta: Int) { adjust(&subscriptions, by: delta) }

  private static func adjust(_ value: inout Int, by delta: Int) {
    lock.lock()
    value += delta
    lock.unlock()
  }

  static func snapshot() -> FakeCounterSnapshot {
    lock.lock()
    defer { lock.unlock() }
    return FakeCounterSnapshot(
      handles: Double(handles),
      resources: Double(resources),
      leases: Double(leases),
      delegates: Double(delegates),
      callbacks: Double(callbacks),
      tasks: Double(tasks),
      buffers: Double(buffers),
      subscriptions: Double(subscriptions)
    )
  }
}

final class FakeCounterSnapshot: @unchecked Sendable {
  let handles: Double
  let resources: Double
  let leases: Double
  let delegates: Double
  let callbacks: Double
  let tasks: Double
  let buffers: Double
  let subscriptions: Double

  init(
    handles: Double,
    resources: Double,
    leases: Double,
    delegates: Double,
    callbacks: Double,
    tasks: Double,
    buffers: Double,
    subscriptions: Double
  ) {
    self.handles = handles
    self.resources = resources
    self.leases = leases
    self.delegates = delegates
    self.callbacks = callbacks
    self.tasks = tasks
    self.buffers = buffers
    self.subscriptions = subscriptions
  }

  convenience init() {
    self.init(
      handles: 0,
      resources: 0,
      leases: 0,
      delegates: 0,
      callbacks: 0,
      tasks: 0,
      buffers: 0,
      subscriptions: 0
    )
  }
}

final class FakeCounters: @unchecked Sendable {
  init() {
    FakeLiveCounts.adjustHandles(1)
  }

  deinit {
    FakeLiveCounts.adjustHandles(-1)
  }

  func snapshot() -> FakeCounterSnapshot {
    FakeLiveCounts.snapshot()
  }
}

/// Two-phase barrier: `started()` waits for arrival; `complete()` releases holders.
final class FakeBarrier: @unchecked Sendable {
  private let lock = NSLock()
  private var arrived = false
  private var released = false
  private var startedWaiters: [CheckedContinuation<Void, Never>] = []
  private var releaseWaiters: [CheckedContinuation<Void, Never>] = []

  init() {
    FakeLiveCounts.adjustHandles(1)
  }

  deinit {
    FakeLiveCounts.adjustHandles(-1)
  }

  func started() async {
    await withCheckedContinuation { (continuation: CheckedContinuation<Void, Never>) in
      lock.lock()
      if arrived {
        lock.unlock()
        continuation.resume()
        return
      }
      startedWaiters.append(continuation)
      lock.unlock()
    }
  }

  func complete() {
    lock.lock()
    released = true
    let waiters = releaseWaiters
    releaseWaiters.removeAll()
    lock.unlock()
    for waiter in waiters {
      waiter.resume()
    }
  }

  /// Operation side: signal arrival, then wait for `complete`.
  func hold() async {
    await withCheckedContinuation { (continuation: CheckedContinuation<Void, Never>) in
      lock.lock()
      arrived = true
      let starters = startedWaiters
      startedWaiters.removeAll()
      if released {
        lock.unlock()
        for starter in starters {
          starter.resume()
        }
        continuation.resume()
        return
      }
      releaseWaiters.append(continuation)
      lock.unlock()
      for starter in starters {
        starter.resume()
      }
    }
  }
}

/// Owned callback box for weak or retained listener registration.
final class FakeListener: @unchecked Sendable {
  private let callback: (Double) throws -> Double
  private let lock = NSLock()
  private var liveCounted = true

  init(_ callback: @escaping (Double) throws -> Double) {
    self.callback = callback
    FakeLiveCounts.adjustHandles(1)
    FakeLiveCounts.adjustDelegates(1)
  }

  deinit {
    FakeLiveCounts.adjustHandles(-1)
    releaseCount()
  }

  func releaseCount() {
    lock.lock()
    let shouldRelease = liveCounted
    liveCounted = false
    lock.unlock()
    if shouldRelease {
      FakeLiveCounts.adjustDelegates(-1)
    }
  }

  func invoke(_ value: Double) throws -> Double {
    try callback(value)
  }
}

final class FakeResource: @unchecked Sendable {
  private enum State {
    case open
    case closing
    case closed
  }

  private let lock = NSLock()
  private var state: State = .open
  private var leases = 0
  private var closeWaiters: [CheckedContinuation<Void, Never>] = []
  private weak var weakListener: FakeListener?
  private var retainedListener: FakeListener?

  init() {
    FakeLiveCounts.adjustHandles(1)
    FakeLiveCounts.adjustResources(1)
  }

  deinit {
    FakeLiveCounts.adjustHandles(-1)
    FakeLiveCounts.adjustResources(-1)
  }

  var closed: Bool {
    lock.lock()
    defer { lock.unlock() }
    return state == .closed
  }

  var closing: Bool {
    lock.lock()
    defer { lock.unlock() }
    return state == .closing || state == .closed
  }

  func registerListener(_ callback: @escaping (Double) throws -> Double, mode: String) throws -> FakeListener {
    lock.lock()
    defer { lock.unlock() }
    if state != .open {
      throw LucentError(code: "CLOSED", message: "Resource no longer accepts listeners")
    }
    let listener = FakeListener(callback)
    if mode == "retained" {
      retainedListener?.releaseCount()
      retainedListener = listener
      weakListener = nil
    } else {
      retainedListener?.releaseCount()
      retainedListener = nil
      weakListener = listener
    }
    return listener
  }

  func clearListener() {
    lock.lock()
    retainedListener?.releaseCount()
    weakListener?.releaseCount()
    retainedListener = nil
    weakListener = nil
    lock.unlock()
  }

  /// Invoke the registered listener. Returns 0 when missing/discarded after close.
  func notify(_ value: Double) throws -> Double {
    lock.lock()
    if state != .open {
      lock.unlock()
      return 0
    }
    let listener = retainedListener ?? weakListener
    lock.unlock()
    guard let listener else { return 0 }
    return try listener.invoke(value)
  }

  func work(barrier: FakeBarrier) async throws {
    lock.lock()
    if state != .open {
      lock.unlock()
      throw LucentError(code: "CLOSED", message: "Resource no longer accepts work")
    }
    leases += 1
    FakeLiveCounts.adjustLeases(1)
    lock.unlock()

    defer {
      finishLease()
    }

    await barrier.hold()
  }

  /// Hold on `barrier`, then invoke `callback` only if the resource is still open.
  func scheduleCallback(barrier: FakeBarrier, _ callback: @escaping () throws -> Double) async throws -> Double {
    lock.lock()
    if state != .open {
      lock.unlock()
      throw LucentError(code: "CLOSED", message: "Resource no longer accepts callbacks")
    }
    leases += 1
    FakeLiveCounts.adjustLeases(1)
    FakeLiveCounts.adjustCallbacks(1)
    lock.unlock()

    defer {
      FakeLiveCounts.adjustCallbacks(-1)
      finishLease()
    }

    await barrier.hold()

    lock.lock()
    let stillOpen = state == .open
    lock.unlock()
    if !stillOpen {
      return 0
    }
    return try callback()
  }

  func close() async {
    await withCheckedContinuation { (continuation: CheckedContinuation<Void, Never>) in
      lock.lock()
      switch state {
      case .closed:
        lock.unlock()
        continuation.resume()
      case .closing:
        if leases == 0 {
          state = .closed
          clearListenerLocked()
          lock.unlock()
          continuation.resume()
        } else {
          closeWaiters.append(continuation)
          lock.unlock()
        }
      case .open:
        state = .closing
        if leases == 0 {
          state = .closed
          clearListenerLocked()
          lock.unlock()
          continuation.resume()
        } else {
          closeWaiters.append(continuation)
          lock.unlock()
        }
      }
    }
  }

  private func finishLease() {
    lock.lock()
    leases -= 1
    FakeLiveCounts.adjustLeases(-1)
    let finished = state == .closing && leases == 0
    let waiters: [CheckedContinuation<Void, Never>]
    if finished {
      state = .closed
      clearListenerLocked()
      waiters = closeWaiters
      closeWaiters.removeAll()
    } else {
      waiters = []
    }
    lock.unlock()
    for waiter in waiters {
      waiter.resume()
    }
  }

  private func clearListenerLocked() {
    retainedListener?.releaseCount()
    weakListener?.releaseCount()
    retainedListener = nil
    weakListener = nil
  }
}

/// Owned subscription with delivery leases and close quiescence.
final class FakeSubscription: @unchecked Sendable {
  private enum State {
    case open
    case closing
    case closed
  }

  private let lock = NSLock()
  private var state: State = .open
  private var activeDeliveries = 0
  private var closeWaiters: [CheckedContinuation<Void, Never>] = []
  private weak var source: FakeEventSource?
  private var liveCounted = true

  init(source: FakeEventSource) {
    self.source = source
    FakeLiveCounts.adjustHandles(1)
    FakeLiveCounts.adjustSubscriptions(1)
  }

  deinit {
    FakeLiveCounts.adjustHandles(-1)
    if liveCounted {
      FakeLiveCounts.adjustSubscriptions(-1)
    }
  }

  var closed: Bool {
    lock.lock()
    defer { lock.unlock() }
    return state == .closed
  }

  var closing: Bool {
    lock.lock()
    defer { lock.unlock() }
    return state == .closing || state == .closed
  }

  func beginDelivery() throws {
    lock.lock()
    defer { lock.unlock() }
    if state != .open {
      throw LucentError(code: "CLOSED", message: "Subscription no longer accepts delivery")
    }
    activeDeliveries += 1
    FakeLiveCounts.adjustCallbacks(1)
  }

  func endDelivery() {
    lock.lock()
    if activeDeliveries == 0 {
      lock.unlock()
      return
    }
    activeDeliveries -= 1
    FakeLiveCounts.adjustCallbacks(-1)
    let finished = state == .closing && activeDeliveries == 0
    lock.unlock()
    if finished {
      finishClose()
    }
  }

  func close() async {
    await withCheckedContinuation { (continuation: CheckedContinuation<Void, Never>) in
      lock.lock()
      switch state {
      case .closed:
        lock.unlock()
        continuation.resume()
      case .closing:
        closeWaiters.append(continuation)
        lock.unlock()
      case .open:
        state = .closing
        if activeDeliveries == 0 {
          lock.unlock()
          finishClose(resuming: continuation)
        } else {
          closeWaiters.append(continuation)
          lock.unlock()
        }
      }
    }
  }

  private func finishClose(resuming immediate: CheckedContinuation<Void, Never>? = nil) {
    source?.detach(self)
    lock.lock()
    state = .closed
    if liveCounted {
      FakeLiveCounts.adjustSubscriptions(-1)
      liveCounted = false
    }
    let waiters = closeWaiters
    closeWaiters.removeAll()
    lock.unlock()
    immediate?.resume()
    for waiter in waiters {
      waiter.resume()
    }
  }
}

final class FakeEventSource: @unchecked Sendable {
  private enum State {
    case open
    case closing
    case closed
  }

  private let lock = NSLock()
  private var state: State = .open
  private var callback: ((Double) throws -> Double)?
  private var subscription: FakeSubscription?

  init() {
    FakeLiveCounts.adjustHandles(1)
    FakeLiveCounts.adjustResources(1)
  }

  deinit {
    FakeLiveCounts.adjustHandles(-1)
    FakeLiveCounts.adjustResources(-1)
  }

  var closed: Bool {
    lock.lock()
    defer { lock.unlock() }
    return state == .closed
  }

  func onEvent(_ callback: @escaping (Double) throws -> Double) throws -> FakeSubscription {
    lock.lock()
    defer { lock.unlock() }
    if state != .open {
      throw LucentError(code: "CLOSED", message: "Event source no longer accepts subscriptions")
    }
    let subscription = FakeSubscription(source: self)
    self.callback = callback
    self.subscription = subscription
    return subscription
  }

  func detach(_ subscription: FakeSubscription) {
    lock.lock()
    if self.subscription === subscription {
      self.subscription = nil
      self.callback = nil
    }
    lock.unlock()
  }

  /// Begin a delivery lease, hold on `barrier`, then invoke the callback if still subscribed.
  func deliver(barrier: FakeBarrier, value: Double) async throws -> Double {
    lock.lock()
    if state != .open {
      lock.unlock()
      return 0
    }
    guard let subscription, let callback else {
      lock.unlock()
      return 0
    }
    lock.unlock()

    do {
      try subscription.beginDelivery()
    } catch {
      return 0
    }

    defer { subscription.endDelivery() }

    await barrier.hold()

    // In-flight deliveries complete even while the subscription is closing.
    lock.lock()
    let active = self.subscription === subscription ? self.callback : nil
    lock.unlock()
    guard let active else { return 0 }
    return try active(value)
  }

  func close() async {
    let pending: FakeSubscription?
    lock.lock()
    switch state {
    case .closed:
      lock.unlock()
      return
    case .closing, .open:
      if state == .open {
        state = .closing
      }
      pending = subscription
      lock.unlock()
    }
    if let pending {
      await pending.close()
    }
    lock.lock()
    state = .closed
    callback = nil
    subscription = nil
    lock.unlock()
  }
}

/// Main-executor UI object for contract tests.
final class FakeUIObject: @unchecked Sendable {
  init() {
    FakeLiveCounts.adjustHandles(1)
  }

  deinit {
    FakeLiveCounts.adjustHandles(-1)
  }

  func ping() -> Double {
    1
  }
}

enum FakeSdk {
  static func createBorrowedBuffer(bytes: Double) throws -> ArrayBuffer {
    FakeLiveCounts.adjustBuffers(1)
    let count = max(0, Int(bytes))
    return try LucentBytes.fromData(Data(count: count))
  }

  static func callSync(_ callback: () throws -> Double) throws -> Double {
    FakeLiveCounts.adjustCallbacks(1)
    defer { FakeLiveCounts.adjustCallbacks(-1) }
    return try callback()
  }

  static func callAsync(barrier: FakeBarrier, _ callback: @escaping () throws -> Double) async throws -> Double {
    FakeLiveCounts.adjustCallbacks(1)
    defer { FakeLiveCounts.adjustCallbacks(-1) }
    await barrier.hold()
    return try callback()
  }

  static func registerListener(
    resource: FakeResource,
    _ callback: @escaping (Double) throws -> Double,
    mode: String
  ) throws -> FakeListener {
    try resource.registerListener(callback, mode: mode)
  }
}
