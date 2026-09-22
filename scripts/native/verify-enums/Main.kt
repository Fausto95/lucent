typealias ArrayBuffer = ByteArray
{{runtime}}
{{packages}}
{{generated}}

fun main() {
  check(lowLevel() == 1.0)
  check(preferred(LucentEnum_Quality.fromLucent("high")) == 2.0)
  check(LucentEnum_Quality.toLucent(chosen()) == "high")
  check(isBest())
  try { LucentEnum_Quality.fromLucent("ultra"); error("Unknown case accepted") }
  catch (error: LucentError) { check(error.code == "INVALID_ENUM_CASE") }
  println("kotlin: SDK enum cases, boundary conversion and unknown-case rejection passed")
}
