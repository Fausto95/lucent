---
"@lucent-lang/lucent": patch
---

Make generated code faster without changing what it computes: strings are one allocation (or none, up to 15 Latin-1 characters) and compare and hash faster as `Map` keys; an arrow function passed straight to `sort`, `map`, `filter`, `forEach`, `reduce` and the like is called directly instead of through a function value; arithmetic whose range is proven, such as `sum = (sum + x) % m`, stays in integer registers; and reading uint32 values back out of a `number[]` no longer mispredicts. On the benchmark kernels, `crc32`, `xorshift`, `wordCount` and `strings` run 1.5–3x faster than before.
