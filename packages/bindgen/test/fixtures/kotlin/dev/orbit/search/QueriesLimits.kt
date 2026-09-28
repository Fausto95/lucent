@file:JvmName("Queries")
@file:JvmMultifileClass

package dev.orbit.search

fun clampLimit(limit: Int?): Int = (limit ?: MAX_LIMIT).coerceIn(1, MAX_LIMIT)
