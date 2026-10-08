---
"@lucent-lang/lucent": patch
---

A JavaScript reload stops the native work module code started: `fromCallback`, `subscribe`, native operations, Android activity requests, iOS presentations and `delay` timers now belong to the runtime's scope, so their cleanups run and their promises reject with an `AbortError` instead of running on for a runtime that is gone.
