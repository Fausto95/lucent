func divide(a: Double, b: Double) throws -> Double {
  if b == 0.0 {
    throw LucentError(code: "DIVIDE_BY_ZERO", message: "Cannot divide by zero")
  }
  return (a / b)
}

func fail() throws -> Void {
  throw LucentError(code: "ALWAYS")
}

func failWithMetadata(path: String) throws -> Void {
  throw LucentError(code: "MISSING", message: "File\n不存在 🌍", metadata: ["path": path, "attempt": 1.0, "retry": false, "detail": lucentNull()])
}
