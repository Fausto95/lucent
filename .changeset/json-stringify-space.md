---
"@lucent-lang/lucent": minor
---

`JSON.stringify` takes its `space` (a number of spaces, at most ten, or a string) and a replacer that lists keys (strings or numbers), as JavaScript does: every object then writes only those keys, in the list's order. A replacer function is still refused (`LUCENT1003`), since it would see each value as `any`.
