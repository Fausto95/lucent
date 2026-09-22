typealias ArrayBuffer = ByteArray
{{runtime}}
{{packages}}
{{generated}}

fun main() {
  val scope = make()
  val first = begin(scope); val second = begin(scope)
  val completed = java.util.concurrent.atomic.AtomicInteger()
  repeat(8) {
    val closing: suspend () -> Unit = { close(scope) }
    closing.startCoroutine(object: Continuation<Unit> {
      override val context = kotlin.coroutines.EmptyCoroutineContext
      override fun resumeWith(result: Result<Unit>) { result.getOrThrow(); completed.incrementAndGet() }
    })
  }
  check(scope.closing && first.cancelled && second.cancelled && scope.activeCount == 2.0)
  check(completed.get() == 0)
  try { scope.begin(); error("accepted closed scope") } catch(error:LucentError) { check(error.code == "CLOSED_SCOPE") }
  try { first.throwIfCancelled(); error("ignored cancellation") } catch(error:LucentError) { check(error.code == "CANCELLED") }
  check(!first.finish() && first.finished && scope.activeCount == 1.0)
  check(completed.get() == 0)
  check(!second.finish())
  check(completed.get() == 8 && scope.activeCount == 0.0)
  check(!first.finish())
  val successScope = make(); val success = successScope.begin()
  val successes = java.util.concurrent.atomic.AtomicInteger()
  val workers = (0 until 8).map { kotlin.concurrent.thread { repeat(125) { if(success.finish()) successes.incrementAndGet() } } }
  workers.forEach { it.join() }
  check(successes.get() == 1 && successScope.activeCount == 0.0)
  success.cancel()
  check(!success.cancelled && success.finished)
  repeat(100) {
    val racingScope = LucentTaskScope(); val racing = racingScope.begin()
    val accepted = java.util.concurrent.atomic.AtomicInteger()
    val cancel = kotlin.concurrent.thread { racing.cancel() }
    val finish = kotlin.concurrent.thread { if(racing.finish()) accepted.incrementAndGet() }
    cancel.join(); finish.join()
    check(racing.finished && racingScope.activeCount == 0.0)
    check(accepted.get() == if(racing.cancelled) 0 else 1)
  }
  val again: suspend () -> Unit = { scope.close() }
  again.startCoroutine(object: Continuation<Unit> {
    override val context = kotlin.coroutines.EmptyCoroutineContext
    override fun resumeWith(result: Result<Unit>) { result.getOrThrow(); completed.incrementAndGet() }
  })
  check(completed.get() == 9)
  println("kotlin: task quiescence, concurrent completion and repeated close passed")
}
