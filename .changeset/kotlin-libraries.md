---
"@lucent-lang/lucent": patch
---

Declare Kotlin libraries on Android as Kotlin declares them, from their Kotlin metadata: parameter names, Kotlin's nullability, properties with their accessors, suspend functions as promises (without their `Continuation`), extensions as functions taking their receiver first, top-level declarations as statics of their facade, and value, sealed, data and object classes. Internal members, `$DefaultImpls` and other compiler plumbing are no longer declared. Calling a suspend function, or passing a value class the JVM unboxes, is refused with a clear error until Lucent generates Kotlin shims; a class whose metadata comes from a newer Kotlin is declared as Java sees it, and `lucent sdk coverage --json` lists why among its reasons.
