---
"@lucent-lang/lucent": patch
---

Build the object literals in a conditional's branches as the type the conditional is used as, so `const o: Options = big ? { name, size } : { name }` no longer throws a `TypeError` at run time.
