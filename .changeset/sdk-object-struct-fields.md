---
"@lucent-lang/lucent": patch
---

An object type with a field holding an SDK object compiles: it stringifies as `{}` (a host object), and a type only one platform's code uses stays out of the other platform's output (#11).
