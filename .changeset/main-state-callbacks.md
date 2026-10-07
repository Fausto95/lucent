---
"@lucent-lang/lucent": patch
---

Let callbacks a component gives the platform (a timer's block, a `postDelayed` runnable) use state only main-thread code uses, as the component's own code does.
