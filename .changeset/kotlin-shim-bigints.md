---
"@lucent-lang/lucent": patch
---

A Kotlin suspend function completing with a `Long` resolves to a bigint, as every native 64-bit integer does, instead of generating C++ that does not compile.
