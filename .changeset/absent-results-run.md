---
"@lucent-lang/lucent": patch
---

Run calls whose result is `undefined` or `null` when that result is passed on, stored or compared, like `show(reset())` or `reset() ?? fallback`, instead of leaving the call out; a function that always throws now throws there too.
