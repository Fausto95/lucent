---
"@lucent-lang/lucent": patch
---

Guard clauses are platform branches: after `if (PLATFORM === "ios") return …;` the rest of the block is Android code, as TypeScript narrows it (#12).
