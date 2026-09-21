package com.margelo.nitro.lucent

object LucentEventHub {
  private val lock = Any()
  private var next = 0
  private val listeners = mutableMapOf<Int, Pair<String, (String) -> Unit>>()
  fun subscribe(event: String, callback: (String) -> Unit): Int = synchronized(lock) {
    next += 1
    listeners[next] = Pair(event, callback)
    next
  }
  fun remove(token: Int) { synchronized(lock) { listeners.remove(token) } }
  fun emit(event: String, payload: Any?) {
    val json = encode(payload)
    val callbacks = synchronized(lock) { listeners.values.filter { it.first == event }.map { it.second } }
    callbacks.forEach { it(json) }
  }
  private fun encode(value: Any?): String = when (value) {
    null -> "null"
    is String -> "\"" + value.map { c -> when (c) {
      '\\' -> "\\\\"
      '"' -> "\\\""
      else -> if (c.code < 32) "\\u" + c.code.toString(16).padStart(4, '0') else c.toString()
    } }.joinToString("") + "\""
    is Boolean -> value.toString()
    is Number -> { require(value.toDouble().isFinite()) { "Event numbers must be finite" }; value.toString() }
    is List<*> -> value.joinToString(",", "[", "]") { encode(it) }
    is Map<*, *> -> value.entries.joinToString(",", "{", "}") { encode(it.key) + ":" + encode(it.value) }
    else -> error("Unsupported event payload")
  }
}
