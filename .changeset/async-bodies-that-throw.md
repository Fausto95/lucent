---
"@lucent-lang/lucent": patch
---

Async functions whose body only throws, like `async function load(): Promise<string> { return fail(); }`, return a rejected promise instead of throwing at the call. Generators without a `yield` run their body on the first `next()` instead of when called, and no longer give invalid C++ when empty.
