struct LucentError: Error {
  let code: String
  let message: String
  let metadata: [String: Any]

  init(code: String, message: String? = nil, metadata: [String: Any] = [:]) {
    self.metadata = metadata
    self.code = code
    self.message = message ?? code
  }
}
