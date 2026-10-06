package dev.orbit.shelf

/**
 * A shelf of titles, as Kotlin collections: read-only lists cross to
 * Lucent as copies, the mutable list is the shelf's own.
 */
class Shelf(titles: List<String> = listOf("orbit", "ocean")) {
  private val items = titles.toMutableList()

  /** A read-only view of the titles, which changes with them. */
  val titles: List<String>
    get() = items

  /** The titles themselves: changing this list changes the shelf. */
  val live: MutableList<String>
    get() = items

  /** Each title's length: numbers Kotlin boxes. */
  fun lengths(): List<Int> = items.map { it.length }

  /** Titles and the gaps between them. */
  fun withGaps(): List<String?> = items.flatMap { listOf(it, null) }.dropLast(1)

  /** The titles in rows of `width`. */
  fun rows(width: Int): List<List<String>> = items.chunked(width)

  /** The same lengths, as an array. */
  fun lengthArray(): IntArray = items.map { it.length }.toIntArray()

  /** Replaces the titles with `titles`, which the shelf copies. */
  fun replace(titles: List<String>) {
    items.clear()
    items.addAll(titles)
  }

  /** `count` titles from `from`: a default before a parameter without one. */
  fun slice(from: Int = 0, count: Int): List<String> = items.drop(from).take(count)

  /** The sum of `values`. */
  fun total(values: List<Double>): Double = values.sum()

  /** `parts` joined, a gap written as `-`. */
  fun join(parts: List<String?>, separator: String = " "): String =
    parts.joinToString(separator) { it ?: "-" }

  /** A list that says it holds no nulls, and holds one (as Java code can make). */
  @Suppress("UNCHECKED_CAST")
  fun broken(): List<String> = listOf("ok", null) as List<String>
}
