package dev.orbit.search

import kotlin.concurrent.thread
import kotlin.coroutines.resume
import kotlin.coroutines.suspendCoroutine
import kotlinx.coroutines.delay

/** One search result: a data class. */
data class Hit(val title: String, val score: Double = 1.0)

/** The titles every searcher searches. */
private val CATALOG = listOf("orbit", "orange", "origin", "ocean", "planet")

/**
 * A client with suspend functions, defaults the JVM cannot see, and
 * properties with setters.
 */
class Searcher(val name: String = "orbit", private val token: String? = null) {
  var pageSize: Int = 2

  var lastQuery: String? = null

  /** The titles starting with `prefix`, after `latency` milliseconds; a query of "!" throws. */
  suspend fun search(prefix: String, limit: Int = pageSize, latency: Long = 0): List<Hit> {
    lastQuery = prefix
    if (latency > 0) delay(latency)
    require(prefix != "!") { "bad query: $prefix" }

    return CATALOG.filter { it.startsWith(prefix) }.take(limit).map { Hit(it) }
  }

  /** How many titles there are. */
  suspend fun count(): Int = CATALOG.size

  /** Completes after `ms` milliseconds on a thread of its own, cancelled or not: its result may come late. */
  suspend fun stubborn(ms: Long): String = suspendCoroutine { continuation ->
    thread {
      Thread.sleep(ms)
      continuation.resume("late")
    }
  }

  suspend fun forget() {
    lastQuery = null
  }

  /** A default that is not null, beside a nullable parameter: leaving it out is not passing null. */
  fun describe(prefix: String = "search", separator: String? = ":"): String =
    "$prefix${separator ?: " "}$name"

  fun token(): String? = token
}
