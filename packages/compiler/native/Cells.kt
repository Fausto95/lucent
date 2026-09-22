package {{androidPackage}}

/** Explicit mutable capture cell. Does not make concurrent mutation safe. */
class LucentCell(initial: Double) {
  private val lock = Any()
  private var stored = initial

  var value: Double
    get() = synchronized(lock) { stored }
    set(value) = synchronized(lock) { stored = value }
}
