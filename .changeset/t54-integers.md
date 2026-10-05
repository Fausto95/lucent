---
"@lucent-lang/lucent": patch
---

Keep arithmetic whose range is proven, such as `sum = (sum + x) % m`, in integer registers: `xorshift` runs 3x faster. Arithmetic that could give -0, NaN or a value past 2^53 stays a double.
