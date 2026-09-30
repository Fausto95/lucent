---
"@lucent-lang/lucent": patch
---

Compile values typed `void | undefined`, like an unannotated `() => item?.update()` or a function declared to return `void | undefined`, and let the result of a call that returns nothing be printed, compared or passed to `typeof`.
