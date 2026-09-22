func lucentNull() -> Any { NSNull() }
func lucentErrorWire(_ code: String, _ message: String, _ metadata: [String: Any]) -> String {
  let normalized = metadata.mapValues { value -> Any in
    if let number = value as? NSNumber, !number.doubleValue.isFinite { return NSNull() }
    return value
  }
  let payload: [String: Any] = ["code": code, "message": message, "metadata": normalized]
  guard let data = try? JSONSerialization.data(withJSONObject: payload, options: [.sortedKeys]) else {
    return "[\(code)] \(message)"
  }
  return "__LUCENT_ERROR_V1__" + data.map { String(format: "%02x", $0) }.joined()
}
