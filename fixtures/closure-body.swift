func apply(value: Double, callback: @escaping (Double) throws -> Double) throws -> Double {
  return try callback(value)
}

func scaled(base: Double) throws -> Double {
  let factor: Double = 3.0
  return try apply(value: base, callback: { (value: Double) throws -> Double in value * factor })
}
