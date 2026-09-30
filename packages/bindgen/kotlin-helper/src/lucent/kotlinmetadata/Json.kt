package lucent.kotlinmetadata

/** Writes maps, lists, strings, numbers, booleans and null as compact JSON. */
fun writeJson(value: Any?, out: StringBuilder) {
  when (value) {
    null -> out.append("null")
    is String -> writeString(value, out)
    is Number, is Boolean -> out.append(value.toString())

    is Map<*, *> -> {
      out.append('{')
      var first = true
      for ((key, item) in value) {
        if (!first) out.append(',')
        first = false
        writeString(key as String, out)
        out.append(':')
        writeJson(item, out)
      }
      out.append('}')
    }

    is List<*> -> {
      out.append('[')
      value.forEachIndexed { i, item ->
        if (i > 0) out.append(',')
        writeJson(item, out)
      }
      out.append(']')
    }

    else -> throw IllegalArgumentException("json: cannot write ${value::class}")
  }
}

private fun writeString(s: String, out: StringBuilder) {
  out.append('"')
  for (c in s) {
    when {
      c == '"' -> out.append("\\\"")
      c == '\\' -> out.append("\\\\")
      c < ' ' -> out.append("\\u").append(String.format("%04x", c.code))
      else -> out.append(c)
    }
  }
  out.append('"')
}
