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
  return lucentInternal_736b35a22321c26_sqrt(lucentInternal_736b35a22321c26_abs(value))
}

fun matches(value: String): Boolean {
  return lucentInternal_2aaae6189ce4e2af_contains(lucentInternal_2aaae6189ce4e2af_trim(value), "lucent")
}

fun roundTrip(text: String): String {
  return lucentInternal_d04f744ec3bed451_decodeUTF8(lucentInternal_d04f744ec3bed451_copyBytes(lucentInternal_d04f744ec3bed451_encodeUTF8(text)))
}
