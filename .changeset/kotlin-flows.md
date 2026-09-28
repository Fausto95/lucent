---
"@lucent-lang/lucent": patch
---

Collect Kotlin flows on Android: `await flow.collect((value) => …, signal)` runs the Lucent function for each value, resolves when the flow completes, rejects with the flow's error or with what the function throws, and cancels the flow when the signal aborts. Lucent functions can be passed where a Kotlin library takes a suspend function (DataStore's `edit`), running while Kotlin waits, and generic Kotlin members (`Flow.collect`, `FlowKt.first`) are called through shims unless their type parameters have bounds other than `Any`.
