fun pick(value: Double): Double {
  return value * 2.0
}

fun choose(flag: Boolean): Double {
  val chosen: Double = if (flag) pick(1.0) else pick(2.0)
  return chosen
}

fun nested(flag: Boolean, other: Boolean): Double {
  return if (flag) pick(3.0) else (if (other) pick(4.0) else 5.0)
}
