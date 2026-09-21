func divide(a: Double, b: Double) throws -> Double {
  if b == 0.0 {
    throw LucentError(code: "DIVIDE_BY_ZERO", message: "Cannot divide by zero")
  }
  return (a / b)
}

func fail() throws -> Void {
  throw LucentError(code: "ALWAYS")
}
