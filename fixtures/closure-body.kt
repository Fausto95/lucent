fun apply(value: Double, callback: (Double) -> Double): Double {
  return callback(value)
}

fun scaled(base: Double): Double {
  val factor: Double = 3.0
  return apply(base, { value: Double -> (value * factor) })
}
