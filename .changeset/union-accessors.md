---
"@lucent-lang/lucent": patch
---

Read a getter through a union of classes that all declare it (`(a as File | Directory).uri`), instead of generating C++ that does not compile.
