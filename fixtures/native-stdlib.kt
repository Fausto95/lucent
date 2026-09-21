fun lucentInternal_736b35a22321c26_abs(value: Double): Double {
  return kotlin.math.abs(value)
}

fun lucentInternal_736b35a22321c26_sqrt(value: Double): Double {
  return kotlin.math.sqrt(value)
}

fun lucentInternal_736b35a22321c26_floor(value: Double): Double {
  return kotlin.math.floor(value)
}

fun lucentInternal_736b35a22321c26_ceil(value: Double): Double {
  return kotlin.math.ceil(value)
}

fun lucentInternal_736b35a22321c26_sin(value: Double): Double {
  return kotlin.math.sin(value)
}

fun lucentInternal_736b35a22321c26_cos(value: Double): Double {
  return kotlin.math.cos(value)
}

fun lucentInternal_736b35a22321c26_min(a: Double, b: Double): Double {
  return kotlin.math.min(a, b)
}

fun lucentInternal_736b35a22321c26_max(a: Double, b: Double): Double {
  return kotlin.math.max(a, b)
}

fun lucentInternal_2aaae6189ce4e2af_trim(value: String): String {
  return value.trim()
}

fun lucentInternal_2aaae6189ce4e2af_contains(value: String, search: String): Boolean {
  return value.contains(search)
}

fun magnitude(value: Double): Double {
  return lucentInternal_736b35a22321c26_sqrt(lucentInternal_736b35a22321c26_abs(value))
}

fun matches(value: String): Boolean {
  return lucentInternal_2aaae6189ce4e2af_contains(lucentInternal_2aaae6189ce4e2af_trim(value), "lucent")
}
