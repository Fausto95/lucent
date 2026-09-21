func fibonacci(n: Double) throws -> Double {
  if n <= 1.0 {
    return n
  }
  return try (fibonacci(n: (n - 1.0)) + fibonacci(n: (n - 2.0)))
}
