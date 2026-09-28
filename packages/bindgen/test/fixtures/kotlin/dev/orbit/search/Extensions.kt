package dev.orbit.search

/* Top-level declarations: the JVM sees them as static members of ExtensionsKt. */

const val MAX_LIMIT: Int = 100

val VERSION: String = "1.0"

var verbose: Boolean = false

fun defaultClient(): SearchClient = SearchClient()

fun String.toQuery(limit: Int = 10): String = take(limit)

val SearchHit.shortTitle: String
  get() = title.take(8)

var StringBuilder.marker: Char
  get() = if (isEmpty()) ' ' else this[0]
  set(value) {
    insert(0, value)
  }

suspend fun SearchClient.first(prefix: String): SearchHit? = search(prefix, 1).firstOrNull()

fun SearchHit.id(): HitId = HitId(title.hashCode().toLong())

inline fun <reified T> List<*>.firstOf(): T? = firstOrNull { it is T } as T?

fun systemName() = System.getProperty("os.name")

internal fun hiddenHelper() {}

private val secret = "hidden"

/** A type annotation, as compiler plugins declare theirs. */
@Target(AnnotationTarget.TYPE)
@Retention(AnnotationRetention.BINARY)
annotation class Marked

fun SearchClient.using(block: @Marked SearchClient.() -> Unit) = block()
