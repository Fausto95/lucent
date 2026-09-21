data class Result(
  var kind: String,
  var value: Double?,
  var message: String?
)

fun evaluate(value: Double): Result {
  if (value < 0.0) {
    return Result(kind = "error", value = null, message = "Negative")
  }
  return Result(kind = "ok", value = value, message = null)
}

fun read(result: Result): Double {
  if (result.kind == "ok") {
    return result.value!!
  }
  return 0.0
}
