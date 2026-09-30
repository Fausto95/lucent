---
"@lucent-lang/lucent": patch
---

Compile `String(x)`, template literals, `+` with a string, `toString()` and `console.log` on arrays, maps, sets, records, `Uint8Array`s and promises, which used to fail with a C++ error. `AbortSignal` and `AbortController` now print as `[object AbortSignal]` and `[object AbortController]`, as in JavaScript.
