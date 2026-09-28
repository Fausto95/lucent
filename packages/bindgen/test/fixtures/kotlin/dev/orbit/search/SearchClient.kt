package dev.orbit.search

/** One search result: a data class, so its componentN and copy are synthesized. */
data class SearchHit(val title: String, val score: Double = 0.0)

/**
 * A client whose suspend function the JVM sees with an extra Continuation
 * parameter, and whose defaults it sees as a synthetic `$default` method.
 */
class SearchClient(val endpoint: String = "https://orbit.invalid", private val token: String? = null) {
  var lastQuery: String? = null
    private set

  lateinit var session: String

  var pageSize: Int = 20

  suspend fun search(prefix: String, limit: Int = 20): List<SearchHit> = emptyList()

  fun searchNow(prefix: String, vararg tags: String): List<SearchHit>? = null

  fun <T : Comparable<T>> best(items: List<T>, fallback: T? = null): T? = items.maxOrNull() ?: fallback

  fun copyInto(target: MutableList<in SearchHit>, source: List<out SearchHit>, any: List<*>) {}

  fun onResult(block: suspend (SearchHit) -> Unit) {}

  @JvmOverloads
  fun configure(retries: Int = 3, label: String = "default") {}

  @JvmName("resetAll")
  fun reset() {}

  internal fun internalHelper() {}

  private fun privateHelper() = token

  companion object {
    const val DEFAULT_LIMIT: Int = 20

    @JvmStatic
    fun create(): SearchClient = SearchClient()
  }

  inner class Cursor(val position: Int)
}

/** A generic class with a declaration-site variance. */
class Page<out T>(val items: List<T>, val next: String?)

internal class InternalThing(val value: Int)

private class PrivateThing
