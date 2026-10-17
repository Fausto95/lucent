---
"@lucent-lang/lucent": patch
---

Android: an exported class whose constructor takes one `bigint` (`constructor(readonly id: bigint)`) compiles to Kotlin. Its wrapper's constructor `(handle: Long)`, which native code calls, clashed with the class's own `(id: Long)` ("Conflicting overloads"), so the bare example's Android build failed. The wrapper's constructor now takes the handle and a `LucentInstance.Wrap`, always null.
