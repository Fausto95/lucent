---
"@lucent-lang/lucent": patch
---

Compile `return fail()`, arrows like `(): string => fail()`, and declarations like `const name: string = fail()`, where `fail` always throws, instead of reporting LUCENT2002.
