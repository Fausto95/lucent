---
"@lucent-lang/lucent": minor
---

Compile `then`, `catch`, `finally`, `Promise.race`, `Promise.any` and `Promise.allSettled`, which were refused, and settle promise code in the microtasks JavaScript does. `Promise.any` rejects with an `AggregateError`, whose `errors` read as `e.errors as Error[]`.

What changes for code that compiled before: `await` of a value that isn't a promise now waits a microtask, as in JavaScript. `return p` in an async function no longer means `return await p`. The function's promise adopts `p` once the function has finished, so a `catch` around the `return` no longer sees `p`'s rejection. Write `return await p` where it should. A promise that never settles is no longer kept alive by a `Promise.all` waiting on it.
