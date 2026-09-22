fun fibonacci(n: Double): Double {
  if (n <= 1.0) {
    return n
  }
  return fibonacci(n - 1.0) + fibonacci(n - 2.0)
}
