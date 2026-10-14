---
"@lucent-lang/lucent": minor
---

Support async generators (`async function*`, `async *` methods) and `for await…of` over them. A generator starts at its first `next()` and queues the calls made while it runs; a loop left early (`break`, `return`, a throw) awaits the generator's `return()`, which runs its `finally` blocks. `next()` and `return()` can be called directly. `yield*` takes an iterable, and `throw()` is not supported.
