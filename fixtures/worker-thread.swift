func summarize(values: [Double]) async throws -> Double {
  return try await Task.detached {
    var total: Double = 0.0
    for value in values {
      total = total + value
    }
    return total
  }.value
}

@MainActor func label(count: Double) async throws -> String {
  return "count: " + lucentStr(count)
}
