---
"@lucent-lang/lucent": patch
---

Compile names that the C library or a platform SDK defines as macros, like `HUGE`, `DOMAIN`, `MIN` or `pascal`, as the ordinary TypeScript names they are, instead of failing to build the generated C++.
