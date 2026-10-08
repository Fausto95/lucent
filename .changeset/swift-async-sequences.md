---
"@lucent-lang/lucent": minor
---

Bind Swift `AsyncSequence`s (StoreKit's `Transaction.updates`, `AsyncStream`, `some AsyncSequence<E, F>`): they are lucent:ios's `AsyncSequence<E>`, collected as a Kotlin `Flow` is, `await seq.collect((e) => …, signal)`, with each element given to the function in order and the sequence waiting for it.
