{{error}}

{{errorWire}}

object LucentBytes {
  fun toByteArray(buffer: ArrayBuffer): ByteArray {
    {{bytesToByteArray}}
  }
  fun fromByteArray(bytes: ByteArray): ArrayBuffer {
    {{bytesFromByteArray}}
  }
  fun length(buffer: ArrayBuffer): Double {
    {{bytesLength}}
  }

  fun get(buffer: ArrayBuffer, index: Double): Double {
    {{bytesGet}}
  }
}

fun lucentStr(value: Double): String {
  if (value.isFinite() && value == Math.rint(value) && Math.abs(value) < 1e15) {
    return value.toLong().toString()
  }
  return value.toString()
}

fun lucentStr(value: Float): String = lucentStr(value.toDouble())
fun lucentStr(value: Int): String = value.toString()
fun lucentStr(value: Long): String = value.toString()
fun lucentStr(value: Short): String = value.toString()
fun lucentStr(value: Byte): String = value.toString()
fun lucentStr(value: UInt): String = value.toString()
fun lucentStr(value: ULong): String = value.toString()
fun lucentStr(value: UShort): String = value.toString()
fun lucentStr(value: UByte): String = value.toString()
fun lucentStr(value: Boolean): String = if (value) "true" else "false"
