func clamp(value: Double, min: Double, max: Double) throws -> Double {
  if value < min {
    return min
  }
  if value > max {
    return max
  }
  return value
}
