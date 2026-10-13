---
"@lucent-lang/lucent": patch
---

Refuse a union type that refers to itself, such as `type Json = null | number | string | Json[] | { [key: string]: Json }`, with LUCENT2002, where the compiler overflowed its stack and crashed.
