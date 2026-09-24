import NitroModules

class HybridBench: HybridBenchSpec {
  func addNumbers(a: Double, b: Double) throws -> Double {
    return a + b
  }

  func addStrings(a: String, b: String) throws -> String {
    return a + b
  }
}
