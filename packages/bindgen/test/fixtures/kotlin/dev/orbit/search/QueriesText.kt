@file:JvmName("Queries")
@file:JvmMultifileClass

package dev.orbit.search

/* Two files that share one JVM facade class, Queries. */

fun normalize(query: String): String = query.trim().lowercase()
