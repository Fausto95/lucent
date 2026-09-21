fun clamp(value: Double, min: Double, max: Double): Double {
  if (value < min) {
    return min
  }
  if (value > max) {
    return max
  }
  return value
}
