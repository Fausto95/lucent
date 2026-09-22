typealias ArrayBuffer = ByteArray
{{runtime}}
{{packages}}
{{generated}}

fun main() {
  val counters = makeCounters()
  val baseline = snapshot(counters)

  // 1. Close while work is in flight (barrier-controlled).
  val barrier = makeBarrier()
  val resource = makeResource()
  val workDone = java.util.concurrent.atomic.AtomicBoolean(false)
  val work: suspend () -> Unit = {
    runWork(resource, barrier)
    workDone.set(true)
  }
  work.startCoroutine(object : Continuation<Unit> {
    override val context = kotlin.coroutines.EmptyCoroutineContext
    override fun resumeWith(result: Result<Unit>) { result.getOrThrow() }
  })
  runBlocking { awaitStarted(barrier) }
  val closeDone = java.util.concurrent.atomic.AtomicBoolean(false)
  val closing: suspend () -> Unit = {
    closeResource(resource)
    closeDone.set(true)
  }
  closing.startCoroutine(object : Continuation<Unit> {
    override val context = kotlin.coroutines.EmptyCoroutineContext
    override fun resumeWith(result: Result<Unit>) { result.getOrThrow() }
  })
  while (!resourceClosing(resource)) Thread.yield()
  completeBarrier(barrier)
  while (!workDone.get() || !closeDone.get()) Thread.yield()
  check(resourceClosed(resource))

  // 2. Late callback after close is discarded (returns 0).
  val lateBarrier = makeBarrier()
  val lateResource = makeResource()
  val lateResult = java.util.concurrent.atomic.AtomicReference(Double.NaN)
  val scheduled: suspend () -> Unit = {
    lateResult.set(schedule(lateResource, lateBarrier) { 42.0 })
  }
  scheduled.startCoroutine(object : Continuation<Unit> {
    override val context = kotlin.coroutines.EmptyCoroutineContext
    override fun resumeWith(result: Result<Unit>) { result.getOrThrow() }
  })
  runBlocking { awaitStarted(lateBarrier) }
  val lateCloseDone = java.util.concurrent.atomic.AtomicBoolean(false)
  val lateClose: suspend () -> Unit = {
    closeResource(lateResource)
    lateCloseDone.set(true)
  }
  lateClose.startCoroutine(object : Continuation<Unit> {
    override val context = kotlin.coroutines.EmptyCoroutineContext
    override fun resumeWith(result: Result<Unit>) { result.getOrThrow() }
  })
  while (!resourceClosing(lateResource)) Thread.yield()
  completeBarrier(lateBarrier)
  while (lateResult.get().isNaN() || !lateCloseDone.get()) Thread.yield()
  check(lateResult.get() == 0.0)
  check(resourceClosed(lateResource))

  // 3. Sync + async callbacks with controllable completion.
  check(callSync { 7.0 } == 7.0)
  val asyncBarrier = makeBarrier()
  val asyncResult = java.util.concurrent.atomic.AtomicReference(Double.NaN)
  val asyncWork: suspend () -> Unit = {
    asyncResult.set(callAsync(asyncBarrier) { 9.0 })
  }
  asyncWork.startCoroutine(object : Continuation<Unit> {
    override val context = kotlin.coroutines.EmptyCoroutineContext
    override fun resumeWith(result: Result<Unit>) { result.getOrThrow() }
  })
  runBlocking { awaitStarted(asyncBarrier) }
  completeBarrier(asyncBarrier)
  while (asyncResult.get().isNaN()) Thread.yield()
  check(asyncResult.get() == 9.0)

  // 4. Retained listener notify; discarded after close.
  val host = makeResource()
  register(host, { value -> value + 1.0 }, "retained")
  check(notify(host, 3.0) == 4.0)
  runBlocking { closeResource(host) }
  check(notify(host, 3.0) == 0.0)

  // 5. Subscription close quiesces in-flight deliveries.
  val source = makeEventSource()
  val subscription = onEvent(source) { value -> value * 2.0 }
  val deliveryBarrier = makeBarrier()
  val deliveryResult = java.util.concurrent.atomic.AtomicReference(Double.NaN)
  val delivery: suspend () -> Unit = {
    deliveryResult.set(deliver(source, deliveryBarrier, 5.0))
  }
  delivery.startCoroutine(object : Continuation<Unit> {
    override val context = kotlin.coroutines.EmptyCoroutineContext
    override fun resumeWith(result: Result<Unit>) { result.getOrThrow() }
  })
  runBlocking { awaitStarted(deliveryBarrier) }
  val subCloseDone = java.util.concurrent.atomic.AtomicBoolean(false)
  val subClose: suspend () -> Unit = {
    closeSubscription(subscription)
    subCloseDone.set(true)
  }
  subClose.startCoroutine(object : Continuation<Unit> {
    override val context = kotlin.coroutines.EmptyCoroutineContext
    override fun resumeWith(result: Result<Unit>) { result.getOrThrow() }
  })
  while (!subscriptionClosing(subscription)) Thread.yield()
  completeBarrier(deliveryBarrier)
  while (deliveryResult.get().isNaN() || !subCloseDone.get()) Thread.yield()
  check(deliveryResult.get() == 10.0)
  check(subscriptionClosed(subscription))
  val discardBarrier = makeBarrier()
  completeBarrier(discardBarrier)
  check(runBlocking { deliver(source, discardBarrier, 1.0) } == 0.0)
  runBlocking { closeEventSource(source) }

  // 6. Counters return to baseline after quiescence.
  val after = snapshot(counters)
  check(after.leases == baseline.leases)
  check(after.callbacks == baseline.callbacks)
  check(after.subscriptions == baseline.subscriptions)
  check(after.delegates == baseline.delegates)

  println("kotlin: fake-sdk barrier close, late discard, callback control, subscription quiescence passed")
}

private fun <T> runBlocking(block: suspend () -> T): T {
  val done = java.util.concurrent.atomic.AtomicReference<Result<T>?>(null)
  block.startCoroutine(object : Continuation<T> {
    override val context = kotlin.coroutines.EmptyCoroutineContext
    override fun resumeWith(result: Result<T>) { done.set(result) }
  })
  while (done.get() == null) Thread.yield()
  return done.get()!!.getOrThrow()
}
