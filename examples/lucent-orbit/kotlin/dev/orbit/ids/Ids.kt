package dev.orbit.ids

/** A value class over a Long: the JVM passes a long where Kotlin sees Id. */
@JvmInline
value class Id(val value: Long)

/** Ids beyond 2^53, where a double would round: Longs, which Lucent passes as bigints. */
class Ids(val base: Long = 9_007_199_254_740_993L) {
  /** The id `step` after `id`: a value class over a Long in and out, and a Long default. */
  fun next(id: Id, step: Long = 1): Id = Id(id.value + step)

  /** A Long result, its Long default left out. */
  fun plus(step: Long = 1): Long = base + step

  /** A suspend function taking and completing with a Long. */
  suspend fun offset(by: Long): Long = base + by

  /** A suspend function completing with a value class over a Long. */
  suspend fun first(): Id = Id(base)

  /** Longs in read-only lists, both ways. */
  fun range(count: Int): List<Long> = List(count) { base + it }

  fun sum(values: List<Long>): Long = values.sum()
}
