private fun lucentJsonString(value: String): String = buildString {
  append('"')

  for (ch in value) when (ch) {
    '"' -> append("\\\"")
    '\\' -> append("\\\\")
    else -> if (ch.code < 32) append("\\u" + ch.code.toString(16).padStart(4, '0')) else append(ch)
  }

  append('"')
}

fun lucentErrorWire(code: String, message: String, metadata: Map<String, Any?>): String {
  val fields = metadata.entries.joinToString(",") { (key, value) ->
    lucentJsonString(key) + ":" + when (value) {
      null -> "null"
      is String -> lucentJsonString(value)
      is Boolean -> value.toString()
      is Number -> if (value.toDouble().isFinite()) value.toString() else "null"
      else -> "null"
    }
  }

  val json = "{\"code\":" + lucentJsonString(code) +
    ",\"message\":" + lucentJsonString(message) +
    ",\"metadata\":{" + fields + "}}"

  return "__LUCENT_ERROR_V1__" + json.toByteArray(Charsets.UTF_8)
    .joinToString("") { (it.toInt() and 255).toString(16).padStart(2, '0') }
}
