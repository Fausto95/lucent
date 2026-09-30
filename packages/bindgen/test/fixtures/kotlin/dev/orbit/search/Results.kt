package dev.orbit.search

/** A value class: one underlying Long, erased on the JVM where it can be. */
@JvmInline
value class HitId(val raw: Long)

/** A sealed interface whose cases are a data class, a data object and a class. */
sealed interface SearchResult {
  data class Found(val hits: List<SearchHit>) : SearchResult

  data object Empty : SearchResult

  class Failed(val error: Throwable) : SearchResult
}

/** A sealed class with nested subclasses. */
sealed class Filter {
  data class Prefix(val value: String) : Filter()

  object All : Filter()
}

enum class Mode(val weight: Int) {
  FAST(1),
  EXACT(2),
}

interface Listener {
  fun onHit(hit: SearchHit)

  fun onDone() {}
}

fun interface HitFilter {
  fun accept(hit: SearchHit): Boolean
}

annotation class Experimental(val reason: String)

abstract class BaseSource {
  protected abstract fun load(id: HitId): SearchHit?

  open fun describe(): String = "source"
}
