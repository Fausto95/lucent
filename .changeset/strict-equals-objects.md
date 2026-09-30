---
"@lucent-lang/lucent": patch
---

Compile `===` and `!==` between arrays, maps, sets, records, `Uint8Array`s and promises, which compare references as in JavaScript, and between bigints in generic functions. They used to fail with a C++ error.
