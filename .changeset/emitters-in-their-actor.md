---
"@lucent-lang/lucent": patch
---

Run an `EventEmitter`'s and its subscriptions' methods from JavaScript in the actor of the module that made the emitter, so they never race that module's own code.
