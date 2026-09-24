package dev.lucent.bench.expo

import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/** NitroBenchmarks' MyExpoModule. */
class BenchExpoModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("BenchExpo")

    Function("addNumbers") { a: Double, b: Double -> a + b }
    Function("addStrings") { a: String, b: String -> a + b }
  }
}
