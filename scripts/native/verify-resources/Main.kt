typealias ArrayBuffer = ByteArray
{{runtime}}
{{packages}}
{{generated}}

fun main() {
  val before = LucentResourceCounts.liveResources
  val resource = make()
  check(LucentResourceCounts.liveResources == before + 1.0)
  begin(resource)
  check(resource.leaseCount == 1.0 && LucentResourceCounts.liveLeases == 1.0)
  val completed = java.util.concurrent.atomic.AtomicInteger()
  repeat(8) {
    val closing: suspend () -> Unit = { close(resource) }
    closing.startCoroutine(object: Continuation<Unit> {
      override val context = kotlin.coroutines.EmptyCoroutineContext
      override fun resumeWith(result: Result<Unit>) { result.getOrThrow(); completed.incrementAndGet() }
    })
  }
  while (true) {
    try {
      resource.beginOperation()
      resource.endOperation()
      Thread.yield()
    } catch (error: LucentError) {
      check(error.code == "CLOSED")
      break
    }
  }
  check(completed.get() == 0 && resource.leaseCount == 1.0 && !resource.closed)
  end(resource)
  while (completed.get() < 8) Thread.yield()
  check(completed.get() == 8 && resource.closed && resource.leaseCount == 0.0)
  check(LucentResourceCounts.liveLeases == 0.0)
  val againClose: suspend () -> Unit = { resource.close() }
  againClose.startCoroutine(object: Continuation<Unit> {
    override val context = kotlin.coroutines.EmptyCoroutineContext
    override fun resumeWith(result: Result<Unit>) { result.getOrThrow() }
  })
  try { resource.beginOperation(); error("accepted closed resource") } catch (error: LucentError) {
    check(error.code == "LIFETIME_ERROR")
  }
  val again = make()
  begin(again)
  val reentrant = java.util.concurrent.atomic.AtomicInteger()
  val pending: suspend () -> Unit = {
    close(again)
    reentrant.incrementAndGet()
  }
  pending.startCoroutine(object: Continuation<Unit> {
    override val context = kotlin.coroutines.EmptyCoroutineContext
    override fun resumeWith(result: Result<Unit>) { result.getOrThrow() }
  })
  while (true) {
    try {
      again.beginOperation()
      again.endOperation()
      Thread.yield()
    } catch (_: LucentError) { break }
  }
  check(reentrant.get() == 0)
  end(again)
  while (reentrant.get() < 1) Thread.yield()
  check(reentrant.get() == 1 && again.closed)
  println("kotlin: resource lease quiescence, concurrent close and reentrant wait passed")
}
