package dev.orbit.shelf

/** A value class: the JVM passes an Int where Kotlin sees Turns. */
@JvmInline
value class Turns(val count: Int)

/** Kotlin's function types, as properties, parameters and results. */
class Dial {
  var onTurn: ((Double) -> Unit)? = null

  var format: (Int) -> String = { it.toString() }

  /** A value class property: its accessors' JVM names are mangled. */
  var turns: Turns = Turns(0)

  fun scaler(): (Double) -> Double = { it * 2 }

  fun filter(test: (String, Int) -> Boolean): Boolean = test("a", 1)
}
