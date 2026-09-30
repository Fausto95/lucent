---
"@lucent-lang/lucent": patch
---

Kotlin's read-only `List<E>` is now an array on Android: a list a Kotlin library returns is copied into an `E[]`, and an array passed where it takes a `List<E>` is copied into a new list, so `await client.search(prefix)` gives an array with `map` and `length`. Numbers Kotlin boxes (`List<Int>`, `Flow<Double>`) are numbers, and `Long`s bigints (`List<Long>` is `bigint[]`), and elements may be `null` where Kotlin's type allows it. A `MutableList`, a `List<*>` and lists Java declarations name stay the Java object, whose changes and identity Lucent code shares; code that called `size()` and `get(i)` on a read-only Kotlin list uses `length` and `[i]` instead.
