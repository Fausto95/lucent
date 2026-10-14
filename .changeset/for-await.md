---
"@lucent-lang/lucent": minor
---

Support `for await…of` over a `Channel`, each value until the channel is closed and drained, and over iterables, each element awaited: `for await (const x of promises)`. Async generators are still refused (`LUCENT2002`).
