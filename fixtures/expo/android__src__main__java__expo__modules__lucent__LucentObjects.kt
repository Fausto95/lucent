package expo.modules.lucent

class LucentObjectLease<T: Any>(value: T, private var cleanup: (() -> Unit)?): AutoCloseable {
  private val lock = Any()
  private var objectValue: T? = value
  val value: T get() = synchronized(lock) {
    objectValue ?: throw LucentError("DISPOSED_OBJECT", "Native lease is closed")
  }
  override fun close() {
    val action = synchronized(lock) { val result = cleanup; cleanup = null; objectValue = null; result }
    action?.invoke()
  }
}
class LucentObjectLeaseGroup(private var leases: Map<Double, LucentObjectLease<Any>>): AutoCloseable {
  private val lock = Any()
  fun <T: Any> get(handle: Double, type: Class<T>): T = synchronized(lock) {
    val value = leases[handle]?.value
    if (!type.isInstance(value)) throw LucentError("DISPOSED_OBJECT", "Invalid or closed native lease")
    type.cast(value)!!
  }
  override fun close() {
    val pending = synchronized(lock) { val result = leases; leases = emptyMap(); result }
    pending.values.forEach { it.close() }
  }
}
private class LucentObjectSerialization(value: Any, val order: Long) {
  val objectValue = java.lang.ref.WeakReference(value)
  val lock = java.util.concurrent.locks.ReentrantLock()
}
object LucentObjectRegistry {
  private val lock = Any()
  private var leases = 0
  private var serializationOrder = 0L
  private val serialization = mutableListOf<LucentObjectSerialization>()
  val activeLeaseCount: Int get() = withLock { leases }
  private var next = 0.0
  private val objects = mutableMapOf<Double, Any>()
  private val identities = java.util.IdentityHashMap<Any, Double>()
  fun <T> withLock(body: () -> T): T = synchronized(lock) { body() }
  fun hold(value: Any): Double = withLock {
    identities[value] ?: run { next += 1; objects[next] = value; identities[value] = next; next }
  }
  fun <T: Any> get(handle: Double, type: Class<T>): T = withLock {
    val value = objects[handle]
    if (!type.isInstance(value)) throw LucentError("DISPOSED_OBJECT", "Invalid or released native object")
    type.cast(value)!!
  }
  fun <T: Any> acquire(handle: Double, type: Class<T>): LucentObjectLease<T> = withLock {
    val value = get(handle, type)
    leases += 1
    LucentObjectLease(value) { withLock { leases -= 1 } }
  }
  fun acquireMany(handles: List<Double>): LucentObjectLeaseGroup = withLock {
    val pending = mutableMapOf<Double, LucentObjectLease<Any>>()
    try {
      handles.distinct().forEach { pending[it] = acquire(it, Any::class.java) }
      LucentObjectLeaseGroup(pending)
    } catch (error: Throwable) { pending.values.forEach { it.close() }; throw error }
  }
  fun <T> withObjects(handles: List<Double>, body: (LucentObjectLeaseGroup) -> T): T {
    val (group, locks) = withLock {
      val group = acquireMany(handles)
      serialization.removeAll { it.objectValue.get() == null }
      val locks = handles.distinct().map { handle ->
        val value = group.get(handle, Any::class.java)
        serialization.firstOrNull { it.objectValue.get() === value } ?: run {
          val entry = LucentObjectSerialization(value, ++serializationOrder)
          serialization.add(entry)
          entry
        }
      }.distinct().sortedBy { it.order }
      Pair(group, locks)
    }
    locks.forEach { it.lock.lock() }
    try { return body(group) } finally {
      locks.asReversed().forEach { it.lock.unlock() }
      group.close()
    }
  }
  fun release(handle: Double) { withLock { objects.remove(handle)?.let { identities.remove(it) }; Unit } }
}
