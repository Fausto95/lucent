package com.margelo.nitro.benchnitro

import com.facebook.proguard.annotations.DoNotStrip

@DoNotStrip
class HybridBench : HybridBenchSpec() {
  override fun addNumbers(a: Double, b: Double): Double = a + b

  override fun addStrings(a: String, b: String): String = a + b
}
