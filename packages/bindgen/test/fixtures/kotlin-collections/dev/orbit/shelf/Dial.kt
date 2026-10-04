package dev.orbit.shelf

/** Kotlin's function types, as properties, parameters and results. */
class Dial {
  var onTurn: ((Double) -> Unit)? = null

  var format: (Int) -> String = { it.toString() }

  fun scaler(): (Double) -> Double = { it * 2 }

  fun filter(test: (String, Int) -> Boolean): Boolean = test("a", 1)
}
