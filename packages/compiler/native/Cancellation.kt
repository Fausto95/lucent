package {{androidPackage}}
class LucentCancellationSource {
  private val lock = Any()
  private val requested = java.util.concurrent.atomic.AtomicBoolean(false)
  private var completed = false
  private val children = mutableListOf<LucentCancellationSource>()
  val cancelled: Boolean get() = requested.get()
  fun cancel() {
    val kids = synchronized(lock) { requested.set(true); children.toList() }
    kids.forEach { it.cancel() }
  }
  fun throwIfCancelled() {
    if (cancelled) throw LucentError("CANCELLED", "Native operation was cancelled")
  }
  fun scope(): LucentCancellationSource {
    val child = LucentCancellationSource()
    val already = synchronized(lock) { children.add(child); requested.get() }
    if (already) child.cancel()
    return child
  }
  fun finish(): Boolean = synchronized(lock) {
    if (requested.get() || completed) return false
    completed = true
    true
  }
}
