---
"@lucent-lang/lucent": patch
---

Compile `reduce` and `reduceRight` with any initial value, such as `xs.reduce((a, c) => a + c, o.n)`, which reported `LUCENT1001`.
