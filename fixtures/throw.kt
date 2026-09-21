fun divide(a: Double, b: Double): Double {
  if (b == 0.0) {
    throw LucentError("DIVIDE_BY_ZERO", message = "Cannot divide by zero")
  }
  return (a / b)
}

fun fail(): Unit {
  throw LucentError("ALWAYS")
}

fun failWithMetadata(path: String): Unit {
  throw LucentError("MISSING", message = "File\n不存在 🌍", metadata = mapOf("path" to path, "attempt" to 1.0, "retry" to false, "detail" to null))
}
