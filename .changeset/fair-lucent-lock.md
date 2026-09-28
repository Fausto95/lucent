---
"@lucent-lang/lucent": patch
---

Let JavaScript call into Lucent while a long async Lucent function yields with `await delay(0)`: threads now take the Lucent lock in the order they asked, so timers, callbacks and aborts no longer wait seconds behind a loop that keeps retaking it.
