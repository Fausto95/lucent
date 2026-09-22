typealias ArrayBuffer = ByteArray
{{runtime}}
{{packages}}
{{generated}}

fun main() {
  check(compute() == 10.0)
  val obj = java.lang.StringBuilder("native")
  val handle = LucentObjectRegistry.hold(obj)
  check(handle == LucentObjectRegistry.hold(obj))
  val lease = LucentObjectRegistry.acquire(handle, java.lang.StringBuilder::class.java)
  val retained = lease.value
  check(retained === obj)
  LucentObjectRegistry.release(handle)
  check(lease.value === obj)
  check(LucentObjectRegistry.activeLeaseCount == 1)
  lease.close()
  lease.close()
  check(LucentObjectRegistry.activeLeaseCount == 0)
  try { LucentObjectRegistry.get(handle, java.lang.StringBuilder::class.java); error("Released handle was accepted") } catch (error:LucentError) { check(error.code == "DISPOSED_OBJECT") }
  try { lease.value; error("Closed lease was accepted") } catch (error:LucentError) { check(error.code == "DISPOSED_OBJECT") }
  val groupHandle = LucentObjectRegistry.hold(obj)
  val group = LucentObjectRegistry.acquireMany(listOf(groupHandle, groupHandle))
  LucentObjectRegistry.release(groupHandle)
  check(group.get(groupHandle, java.lang.StringBuilder::class.java) === obj)
  check(LucentObjectRegistry.activeLeaseCount == 1)
  group.close(); group.close()
  check(LucentObjectRegistry.activeLeaseCount == 0)
  val valid = LucentObjectRegistry.hold(obj)
  try { LucentObjectRegistry.acquireMany(listOf(valid, -1.0)); error("Invalid group accepted") } catch (error:LucentError) { check(error.code == "DISPOSED_OBJECT") }
  check(LucentObjectRegistry.activeLeaseCount == 0)
  LucentObjectRegistry.release(valid)
  val workers = (0 until 8).map { kotlin.concurrent.thread {
    repeat(125) {
      val item = Any()
      val id = LucentObjectRegistry.hold(item)
      LucentObjectRegistry.acquire(id, Any::class.java).use { LucentObjectRegistry.release(id) }
    }
  } }
  workers.forEach { it.join() }
  check(LucentObjectRegistry.activeLeaseCount == 0)
  val serialized = LucentObjectRegistry.hold(java.lang.StringBuilder())
  val serialWorkers = (0 until 8).map { kotlin.concurrent.thread {
    repeat(125) { LucentObjectRegistry.withObjects(listOf(serialized, serialized)) { snapshot ->
      snapshot.get(serialized, java.lang.StringBuilder::class.java).append("x")
    } }
  } }
  serialWorkers.forEach { it.join() }
  check(LucentObjectRegistry.get(serialized, java.lang.StringBuilder::class.java).length == 1000)
  val independent = LucentObjectRegistry.hold(Any())
  LucentObjectRegistry.withObjects(listOf(serialized)) { snapshot ->
    val done = java.util.concurrent.CountDownLatch(1)
    val worker = kotlin.concurrent.thread {
      LucentObjectRegistry.withObjects(listOf(independent)) {
        val temporary = LucentObjectRegistry.hold(Any()); LucentObjectRegistry.release(temporary)
      }
      done.countDown()
    }
    check(done.await(5, java.util.concurrent.TimeUnit.SECONDS)) { "SDK call held registry-wide synchronization" }
    worker.join()
    LucentObjectRegistry.release(serialized)
    val value = snapshot.get(serialized, java.lang.StringBuilder::class.java)
    check(value.length == 1000)
    val replacement = LucentObjectRegistry.hold(value)
    LucentObjectRegistry.withObjects(listOf(replacement)) { nested -> check(nested.get(replacement, java.lang.StringBuilder::class.java) === value) }
    LucentObjectRegistry.release(replacement)
  }
  LucentObjectRegistry.release(independent)
  check(LucentObjectRegistry.activeLeaseCount == 0)
  val throwing = LucentObjectRegistry.hold(Any())
  try { LucentObjectRegistry.withObjects(listOf(throwing)) { error("failure") } } catch(error:IllegalStateException) { }
  check(LucentObjectRegistry.activeLeaseCount == 0)
  LucentObjectRegistry.release(throwing)
  println("kotlin: native callbacks, identity, invalidation and 1000 concurrent lease releases passed")
}
