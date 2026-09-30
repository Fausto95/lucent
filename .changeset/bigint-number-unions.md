---
"@lucent-lang/lucent": patch
---

Convert and compare values that are a bigint or a number (an SDK constant or a 64-bit value), possibly absent, as JavaScript does: `Number(x)`, `BigInt(x)`, `<` and the other relational operators, unary `-` and `~`, and `++`/`--`. `Number()` and `BigInt()` of such unions were refused, and comparisons and unary minus threw at run time.
