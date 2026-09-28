---
"@lucent-lang/lucent": minor
---

Swift async methods take an `AbortSignal` last, as Kotlin suspend functions do: aborting it, or the calling context going away (a reload), rejects the promise at once with `AbortError` and cancels the Swift task, and a result that arrives afterwards is released instead of delivered.
