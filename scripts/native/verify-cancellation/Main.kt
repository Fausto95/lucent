typealias ArrayBuffer = ByteArray
{{runtime}}
{{packages}}
{{generated}}

fun main() {
  val source=make()
  check(!checkpoint(source))
  val workers=(0 until 8).map { kotlin.concurrent.thread { repeat(125) { cancel(source) } } }
  workers.forEach { it.join() }
  try { checkpoint(source); error("Cancellation was ignored") } catch (error:LucentError) { check(error.code == "CANCELLED") }
  cancel(source)
  val parent = make()
  val scoped = child(parent)
  cancel(parent)
  try { checkpoint(scoped); error("Child scope ignored cancellation") } catch (error:LucentError) { check(error.code == "CANCELLED") }
  val finished = make()
  check(complete(finished))
  check(!complete(finished))
  val cancelled = make()
  cancel(cancelled)
  check(!complete(cancelled))
  println("kotlin: cooperative cancellation, typed errors and concurrent cancellation passed")
}
