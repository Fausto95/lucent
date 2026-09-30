---
"@lucent-lang/lucent": patch
---

Compile optional calls of methods and functions that return nothing, like `signal?.addEventListener("abort", …)` or `callback?.()`, instead of generating C++ that does not build.
