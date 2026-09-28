package dev.orbit.shelf

import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.flowOf

/**
 * Collections as Kotlin declares them: read-only lists, which cross as
 * copies, beside mutable lists, star-projected lists and arrays, which do
 * not.
 */
class Shelf {
  private val items = mutableListOf("a", "b")

  /** A read-only view of state that changes. */
  val titles: List<String>
    get() = items

  /** The same state, as the mutable list it is. */
  val live: MutableList<String>
    get() = items

  fun counts(): List<Int> = items.map { it.length }

  fun maybe(): List<String?> = listOf("x", null)

  fun grid(): List<List<Int>> = listOf(listOf(1, 2), listOf(3))

  fun sizes(): IntArray = intArrayOf(1, 2)

  fun names(): Array<String> = arrayOf("a")

  fun total(values: List<Long>): Long = values.sum()

  fun join(parts: List<String?>, separator: String = ","): String = parts.joinToString(separator)

  fun anything(values: List<*>): Int = values.size

  fun optional(): List<Double>? = null

  fun counted(): Flow<Int> = flowOf(1, 2)
}

/** A generic class: its lists hold a type parameter's values. */
class Box<T>(val value: T) {
  fun repeat(n: Int): List<T> = List(n) { value }

  fun count(values: List<T>): Int = values.size
}

/** Type parameters with bounds: non-null, and a class. */
class Keyed<K : Any, V : Comparable<V>>(val key: K, val value: V)

/** A fun interface whose function suspends. */
fun interface Visitor<T> {
  suspend fun visit(value: T)
}
