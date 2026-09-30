package androidx.compose.ui.unit

@JvmInline
value class Dp(val value: Float) {
  operator fun plus(other: Dp): Dp = Dp(value + other.value)

  companion object {
    val Hairline: Dp = Dp(0f)
  }
}

val Int.dp: Dp
  get() = Dp(toFloat())

val Double.dp: Dp
  get() = Dp(toFloat())

@JvmInline value class TextUnit(val packedValue: Long)

val Int.sp: TextUnit
  get() = TextUnit(toLong())
