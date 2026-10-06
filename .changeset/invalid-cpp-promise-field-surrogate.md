---
"@lucent-lang/lucent": patch
---

Fix C++ that failed to compile for a string literal holding a lone surrogate (`"\uD800"`), and for a class or object with a `Promise` field: `JSON.stringify` writes a promise as `{}`, as in JavaScript
