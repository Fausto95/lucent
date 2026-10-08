# 0055. Swift AsyncSequences are collected as Flows are

- **Date:** 2026-10-08
- **Status:** accepted

An AsyncSequence (AsyncStream, `some AsyncSequence<E, F>`, or a module's type conforming to it, such as StoreKit's `Transaction.Transactions`) is lucent:ios's `AsyncSequence<E>`, whose `collect(f, signal?)` iterates it in a Swift task, waiting for `f` on the Lucent thread at each element, and settles when the sequence ends or throws; the signal cancels the task. _Why:_ Kotlin's Flow.collect has the same shape, so ports read the same on both platforms; a JavaScript async iterator was rejected because Lucent has no `for await` over native values yet, and a subscription without backpressure would buffer a fast sequence without bound.
