fun divide(a: Double, b: Double): Double {
  if (b == 0.0) {
    throw LucentError("DIVIDE_BY_ZERO", "Cannot divide by zero")
  }
  return (a / b)
}

fun fail(): Unit {
  throw LucentError("ALWAYS")
}
