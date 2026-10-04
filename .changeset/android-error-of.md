---
"@lucent-lang/lucent": patch
---

Add `errorOf(throwable)` to `lucent:android`: the `Error` Lucent makes of a thrown Java exception (its `code` the class name, `java.lang.IllegalStateException`), for adapters whose callback API reports failure with a `Throwable`. `reject(errorOf(e))` now rejects as the call would have thrown.
