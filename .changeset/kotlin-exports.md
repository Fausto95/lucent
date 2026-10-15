---
"@lucent-lang/lucent": minor
---

Kotlin and Java can call a module's exports. Each module gets `dev.lucent.app.<module>.Exports.kt`, whose top-level functions Java sees as the class `Exports`, with `suspend` functions for async exports; each exported class gets an open wrapper class in the same package that makes, calls and releases its instances (`close()`, or the finalizer). What Lucent code throws is a `dev.lucent.LucentException` with its `name`, `message` and `code`. The Android library now always applies the Kotlin plugin; kotlinx-coroutines stays a dependency of Kotlin shims alone.
