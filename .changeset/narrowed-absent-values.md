---
"@lucent-lang/lucent": patch
---

Read optional values the checker narrows to `undefined` or `null`, like `s` in `const s: string | undefined = undefined; show(s)` or after `if (s === undefined)`, instead of reporting LUCENT2002.
