---
"@lucent-lang/lucent": patch
---

Count `x as T` conversions that check the value, element reads narrowed present, and bigint `/`, `%` and `**` as code that can throw, so effect summaries (and what relies on them, like main-thread and compute checks) no longer call such functions throw-free.
