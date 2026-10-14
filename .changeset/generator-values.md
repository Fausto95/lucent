---
"@lucent-lang/lucent": minor
---

Generators typed `Generator<T, TReturn, TNext>` take values and return one: `const x = yield v` gives what `next(x)` sends, `return v` ends the generator with `{ value: v, done: true }`, and `throw(e)` throws `e` where it waits. `return(v)` runs its `finally` blocks. `yield*` hands `next(x)`, `throw()` and `return()` to the iterator it delegates to, and gives what that returned.
