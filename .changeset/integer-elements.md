---
"@lucent-lang/lucent": patch
---

Faster lookup tables: a local `number[]` that only ever holds integers, and that is only pushed to, indexed and measured, keeps them as integers, so a read such as `table[i]!` in a CRC-32 loop no longer converts each element from a double.
