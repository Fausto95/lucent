fun lucentInternal_a2e2c7dbb96a1210_abs(value: Double): Double {
  return kotlin.math.abs(value)
}

fun lucentInternal_a2e2c7dbb96a1210_sqrt(value: Double): Double {
  return kotlin.math.sqrt(value)
}

fun lucentInternal_a2e2c7dbb96a1210_floor(value: Double): Double {
  return kotlin.math.floor(value)
}

fun lucentInternal_a2e2c7dbb96a1210_ceil(value: Double): Double {
  return kotlin.math.ceil(value)
}

fun lucentInternal_a2e2c7dbb96a1210_sin(value: Double): Double {
  return kotlin.math.sin(value)
}

fun lucentInternal_a2e2c7dbb96a1210_cos(value: Double): Double {
  return kotlin.math.cos(value)
}

fun lucentInternal_a2e2c7dbb96a1210_min(a: Double, b: Double): Double {
  return kotlin.math.min(a, b)
}

fun lucentInternal_a2e2c7dbb96a1210_max(a: Double, b: Double): Double {
  return kotlin.math.max(a, b)
}

fun lucentInternal_e08d398e59797131_trim(value: String): String {
  return value.trim()
}

fun lucentInternal_e08d398e59797131_contains(value: String, search: String): Boolean {
  return value.contains(search)
}

fun lucentInternal_d04f744ec3bed451_encodeUTF8(text: String): ArrayBuffer {
  return LucentBytes.fromByteArray(text.toByteArray(Charsets.UTF_8))
}

fun lucentInternal_d04f744ec3bed451_decodeUTF8(bytes: ArrayBuffer): String {
  return LucentBytes.toByteArray(bytes).toString(Charsets.UTF_8)
}

fun lucentInternal_d04f744ec3bed451_copyBytes(bytes: ArrayBuffer): ArrayBuffer {
  return LucentBytes.fromByteArray(LucentBytes.toByteArray(bytes))
}

fun magnitude(value: Double): Double {
  return lucentInternal_a2e2c7dbb96a1210_sqrt(lucentInternal_a2e2c7dbb96a1210_abs(value))
}

fun matches(value: String): Boolean {
  return lucentInternal_e08d398e59797131_contains(lucentInternal_e08d398e59797131_trim(value), "lucent")
}

fun roundTrip(text: String): String {
  return lucentInternal_d04f744ec3bed451_decodeUTF8(lucentInternal_d04f744ec3bed451_copyBytes(lucentInternal_d04f744ec3bed451_encodeUTF8(text)))
}
