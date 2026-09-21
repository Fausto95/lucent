suspend fun scale(value: Double): Double {
  return (value * 2.0)
}

suspend fun total(values: MutableList<Double>): Double {
  var sum: Double = 0.0
  for (value in values) {
    sum = (sum + value)
  }
  return scale(sum)
}
