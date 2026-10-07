---
"@lucent-lang/lucent": minor
---

Let a view use module state that only main-thread code uses (components and `main()` callbacks), such as a map of native players a class keeps by id, instead of refusing it with LUCENT3022; any other module state is still refused, now saying why it is not the main thread's alone.
