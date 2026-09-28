---
"@lucent-lang/lucent": patch
---

Stop refusing a function passed to `compute` because another module's code that the platform calls back (a kept callback, an override of a platform class's method, a protocol method) uses module state: that code runs on the module's thread, holding its lock, not in the task.
