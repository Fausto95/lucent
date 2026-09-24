import ExpoModulesCore

/** NitroBenchmarks' MyExpoModule. */
public class BenchExpoModule: Module {
  public func definition() -> ModuleDefinition {
    Name("BenchExpo")

    Function("addNumbers") { (a: Double, b: Double) in
      return a + b
    }
    Function("addStrings") { (a: String, b: String) in
      return a + b
    }
  }
}
