struct Result {
  var kind: String
  var value: Double?
  var message: String?
}

func evaluate(value: Double) throws -> Result {
  if value < 0.0 {
    return Result(kind: "error", value: nil, message: "Negative")
  }
  return Result(kind: "ok", value: value, message: nil)
}

func read(result: Result) throws -> Double {
  if result.kind == "ok" {
    return result.value!
  }
  return 0.0
}
