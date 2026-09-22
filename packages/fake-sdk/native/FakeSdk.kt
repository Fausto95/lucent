package {{androidPackage}}

import kotlin.coroutines.Continuation
import kotlin.coroutines.resume
import kotlin.coroutines.suspendCoroutine

/** Process-wide live-object counts for the fake SDK. */
object FakeLiveCounts {
  private val lock = Any()
  private var handles = 0
  private var resources = 0
  private var leases = 0
  private var delegates = 0
  private var callbacks = 0
  private var tasks = 0
  private var buffers = 0
  private var subscriptions = 0

  fun adjust(key: String, delta: Int) = synchronized(lock) {
    when (key) {
      "handles" -> handles += delta
      "resources" -> resources += delta
      "leases" -> leases += delta
      "delegates" -> delegates += delta
      "callbacks" -> callbacks += delta
      "tasks" -> tasks += delta
      "buffers" -> buffers += delta
      "subscriptions" -> subscriptions += delta
    }
  }

  fun snapshot(): FakeCounterSnapshot = synchronized(lock) {
    FakeCounterSnapshot(
      handles.toDouble(),
      resources.toDouble(),
      leases.toDouble(),
      delegates.toDouble(),
      callbacks.toDouble(),
      tasks.toDouble(),
      buffers.toDouble(),
      subscriptions.toDouble(),
    )
  }
}

class FakeCounterSnapshot(
  val handles: Double,
  val resources: Double,
  val leases: Double,
  val delegates: Double,
  val callbacks: Double,
  val tasks: Double,
  val buffers: Double,
  val subscriptions: Double,
) {
  constructor() : this(0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0)
}

class FakeCounters {
  init {
    FakeLiveCounts.adjust("handles", 1)
  }

  fun snapshot(): FakeCounterSnapshot = FakeLiveCounts.snapshot()
}

/** Two-phase barrier: `started()` waits for arrival; `complete()` releases holders. */
class FakeBarrier {
  private val lock = Any()
  private var arrived = false
  private var released = false
  private val startedWaiters = mutableListOf<Continuation<Unit>>()
  private val releaseWaiters = mutableListOf<Continuation<Unit>>()

  init {
    FakeLiveCounts.adjust("handles", 1)
  }

  suspend fun started(): Unit = suspendCoroutine { continuation ->
    val resumeNow = synchronized(lock) {
      if (arrived) true else {
        startedWaiters.add(continuation)
        false
      }
    }
    if (resumeNow) continuation.resume(Unit)
  }

  fun complete() {
    val waiters = synchronized(lock) {
      released = true
      val pending = releaseWaiters.toList()
      releaseWaiters.clear()
      pending
    }
    waiters.forEach { it.resume(Unit) }
  }

  /** Operation side: signal arrival, then wait for `complete`. */
  suspend fun hold(): Unit = suspendCoroutine { continuation ->
    val starters = synchronized(lock) {
      arrived = true
      val pending = startedWaiters.toList()
      startedWaiters.clear()
      if (released) {
        Pair(pending, true)
      } else {
        releaseWaiters.add(continuation)
        Pair(pending, false)
      }
    }
    starters.first.forEach { it.resume(Unit) }
    if (starters.second) continuation.resume(Unit)
  }
}

/** Owned callback box for weak or retained listener registration. */
class FakeListener(private val callback: (Double) -> Double) {
  private val lock = Any()
  @Volatile private var liveCounted = true

  init {
    FakeLiveCounts.adjust("handles", 1)
    FakeLiveCounts.adjust("delegates", 1)
  }

  fun releaseCount() {
    val shouldRelease = synchronized(lock) {
      if (!liveCounted) false else {
        liveCounted = false
        true
      }
    }
    if (shouldRelease) FakeLiveCounts.adjust("delegates", -1)
  }

  fun invoke(value: Double): Double = callback(value)
}

class FakeResource {
  private enum class State {
    OPEN,
    CLOSING,
    CLOSED,
  }

  private val lock = Any()
  private var state = State.OPEN
  private var leases = 0
  private val closeWaiters = mutableListOf<Continuation<Unit>>()
  @Volatile private var weakListener: java.lang.ref.WeakReference<FakeListener>? = null
  private var retainedListener: FakeListener? = null

  init {
    FakeLiveCounts.adjust("handles", 1)
    FakeLiveCounts.adjust("resources", 1)
  }

  val closed: Boolean
    get() = synchronized(lock) { state == State.CLOSED }

  val closing: Boolean
    get() = synchronized(lock) { state == State.CLOSING || state == State.CLOSED }

  fun registerListener(callback: (Double) -> Double, mode: String): FakeListener {
    synchronized(lock) {
      if (state != State.OPEN) throw LucentError("CLOSED", "Resource no longer accepts listeners")
      val listener = FakeListener(callback)
      if (mode == "retained") {
        retainedListener?.releaseCount()
        retainedListener = listener
        weakListener = null
      } else {
        retainedListener?.releaseCount()
        retainedListener = null
        weakListener = java.lang.ref.WeakReference(listener)
      }
      return listener
    }
  }

  fun clearListener() {
    synchronized(lock) {
      retainedListener?.releaseCount()
      weakListener?.get()?.releaseCount()
      retainedListener = null
      weakListener = null
    }
  }

  /** Invoke the registered listener. Returns 0 when missing/discarded after close. */
  fun notify(value: Double): Double {
    val listener = synchronized(lock) {
      if (state != State.OPEN) return 0.0
      retainedListener ?: weakListener?.get()
    } ?: return 0.0
    return listener.invoke(value)
  }

  suspend fun work(barrier: FakeBarrier) {
    synchronized(lock) {
      if (state != State.OPEN) throw LucentError("CLOSED", "Resource no longer accepts work")
      leases += 1
      FakeLiveCounts.adjust("leases", 1)
    }

    try {
      barrier.hold()
    } finally {
      val waiters = synchronized(lock) {
        leases -= 1
        FakeLiveCounts.adjust("leases", -1)
        if (state == State.CLOSING && leases == 0) {
          state = State.CLOSED
          retainedListener?.releaseCount()
          weakListener?.get()?.releaseCount()
          retainedListener = null
          weakListener = null
          val pending = closeWaiters.toList()
          closeWaiters.clear()
          pending
        } else emptyList()
      }
      waiters.forEach { it.resume(Unit) }
    }
  }

  /** Hold on `barrier`, then invoke `callback` only if the resource is still open. */
  suspend fun scheduleCallback(barrier: FakeBarrier, callback: () -> Double): Double {
    synchronized(lock) {
      if (state != State.OPEN) throw LucentError("CLOSED", "Resource no longer accepts callbacks")
      leases += 1
      FakeLiveCounts.adjust("leases", 1)
      FakeLiveCounts.adjust("callbacks", 1)
    }

    try {
      barrier.hold()
      val stillOpen = synchronized(lock) { state == State.OPEN }
      if (!stillOpen) return 0.0
      return callback()
    } finally {
      FakeLiveCounts.adjust("callbacks", -1)
      val waiters = synchronized(lock) {
        leases -= 1
        FakeLiveCounts.adjust("leases", -1)
        if (state == State.CLOSING && leases == 0) {
          state = State.CLOSED
          retainedListener?.releaseCount()
          weakListener?.get()?.releaseCount()
          retainedListener = null
          weakListener = null
          val pending = closeWaiters.toList()
          closeWaiters.clear()
          pending
        } else emptyList()
      }
      waiters.forEach { it.resume(Unit) }
    }
  }

  suspend fun close(): Unit = suspendCoroutine { continuation ->
    val resumeNow = synchronized(lock) {
      when (state) {
        State.CLOSED -> true
        State.CLOSING -> {
          if (leases == 0) {
            state = State.CLOSED
            retainedListener?.releaseCount()
            weakListener?.get()?.releaseCount()
            retainedListener = null
            weakListener = null
            true
          } else {
            closeWaiters.add(continuation)
            false
          }
        }
        State.OPEN -> {
          state = State.CLOSING
          if (leases == 0) {
            state = State.CLOSED
            retainedListener?.releaseCount()
            weakListener?.get()?.releaseCount()
            retainedListener = null
            weakListener = null
            true
          } else {
            closeWaiters.add(continuation)
            false
          }
        }
      }
    }
    if (resumeNow) continuation.resume(Unit)
  }
}

/** Owned subscription with delivery leases and close quiescence. */
class FakeSubscription(private var source: FakeEventSource?) {
  private enum class State {
    OPEN,
    CLOSING,
    CLOSED,
  }

  private val lock = Any()
  private var state = State.OPEN
  private var activeDeliveries = 0
  private val closeWaiters = mutableListOf<Continuation<Unit>>()
  @Volatile private var liveCounted = true

  init {
    FakeLiveCounts.adjust("handles", 1)
    FakeLiveCounts.adjust("subscriptions", 1)
  }

  val closed: Boolean
    get() = synchronized(lock) { state == State.CLOSED }

  val closing: Boolean
    get() = synchronized(lock) { state == State.CLOSING || state == State.CLOSED }

  fun beginDelivery() {
    synchronized(lock) {
      if (state != State.OPEN) throw LucentError("CLOSED", "Subscription no longer accepts delivery")
      activeDeliveries += 1
      FakeLiveCounts.adjust("callbacks", 1)
    }
  }

  fun endDelivery() {
    val finished = synchronized(lock) {
      if (activeDeliveries == 0) return
      activeDeliveries -= 1
      FakeLiveCounts.adjust("callbacks", -1)
      state == State.CLOSING && activeDeliveries == 0
    }
    if (finished) finishClose()
  }

  suspend fun close(): Unit = suspendCoroutine { continuation ->
    val resumeNow = synchronized(lock) {
      when (state) {
        State.CLOSED -> true
        State.CLOSING -> {
          closeWaiters.add(continuation)
          false
        }
        State.OPEN -> {
          state = State.CLOSING
          if (activeDeliveries == 0) {
            null
          } else {
            closeWaiters.add(continuation)
            false
          }
        }
      }
    }
    when (resumeNow) {
      true -> continuation.resume(Unit)
      false -> {}
      null -> finishClose(continuation)
    }
  }

  private fun finishClose(immediate: Continuation<Unit>? = null) {
    source?.detach(this)
    source = null
    val waiters = synchronized(lock) {
      state = State.CLOSED
      if (liveCounted) {
        FakeLiveCounts.adjust("subscriptions", -1)
        liveCounted = false
      }
      val pending = closeWaiters.toList()
      closeWaiters.clear()
      pending
    }
    immediate?.resume(Unit)
    waiters.forEach { it.resume(Unit) }
  }
}

class FakeEventSource {
  private enum class State {
    OPEN,
    CLOSING,
    CLOSED,
  }

  private val lock = Any()
  private var state = State.OPEN
  private var callback: ((Double) -> Double)? = null
  private var subscription: FakeSubscription? = null

  init {
    FakeLiveCounts.adjust("handles", 1)
    FakeLiveCounts.adjust("resources", 1)
  }

  val closed: Boolean
    get() = synchronized(lock) { state == State.CLOSED }

  fun onEvent(callback: (Double) -> Double): FakeSubscription {
    synchronized(lock) {
      if (state != State.OPEN) throw LucentError("CLOSED", "Event source no longer accepts subscriptions")
      val subscription = FakeSubscription(this)
      this.callback = callback
      this.subscription = subscription
      return subscription
    }
  }

  fun detach(subscription: FakeSubscription) {
    synchronized(lock) {
      if (this.subscription === subscription) {
        this.subscription = null
        this.callback = null
      }
    }
  }

  /** Begin a delivery lease, hold on `barrier`, then invoke the callback if still subscribed. */
  suspend fun deliver(barrier: FakeBarrier, value: Double): Double {
    val pair = synchronized(lock) {
      if (state != State.OPEN) return 0.0
      val subscription = this.subscription ?: return 0.0
      val callback = this.callback ?: return 0.0
      Pair(subscription, callback)
    }

    try {
      pair.first.beginDelivery()
    } catch (_: LucentError) {
      return 0.0
    }

    try {
      barrier.hold()
      // In-flight deliveries complete even while the subscription is closing.
      val active = synchronized(lock) {
        if (this.subscription === pair.first) this.callback else null
      } ?: return 0.0
      return active(value)
    } finally {
      pair.first.endDelivery()
    }
  }

  suspend fun close() {
    val pending = synchronized(lock) {
      when (state) {
        State.CLOSED -> return
        State.CLOSING, State.OPEN -> {
          if (state == State.OPEN) state = State.CLOSING
          subscription
        }
      }
    }
    pending?.close()
    synchronized(lock) {
      state = State.CLOSED
      callback = null
      subscription = null
    }
  }
}

/** Main-executor UI object for contract tests. */
class FakeUIObject {
  init {
    FakeLiveCounts.adjust("handles", 1)
  }

  fun ping(): Double = 1.0
}

object FakeSdk {
  fun createBorrowedBuffer(bytes: Double): ArrayBuffer {
    FakeLiveCounts.adjust("buffers", 1)
    val count = maxOf(0, bytes.toInt())
    return LucentBytes.fromByteArray(ByteArray(count))
  }

  fun callSync(callback: () -> Double): Double {
    FakeLiveCounts.adjust("callbacks", 1)
    try {
      return callback()
    } finally {
      FakeLiveCounts.adjust("callbacks", -1)
    }
  }

  suspend fun callAsync(barrier: FakeBarrier, callback: () -> Double): Double {
    FakeLiveCounts.adjust("callbacks", 1)
    try {
      barrier.hold()
      return callback()
    } finally {
      FakeLiveCounts.adjust("callbacks", -1)
    }
  }

  fun registerListener(resource: FakeResource, callback: (Double) -> Double, mode: String): FakeListener =
    resource.registerListener(callback, mode)
}
