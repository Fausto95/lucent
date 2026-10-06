---
"@lucent-lang/lucent": patch
---

Spread a record that may be undefined into a record literal, and refuse spreading an object or a class instance into one with `LUCENT1001` (a record of another value type with `LUCENT2004`) instead of generating C++ that fails to build
