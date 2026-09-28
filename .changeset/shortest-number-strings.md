---
"@lucent-lang/lucent": patch
---

Numbers print exactly as JavaScript prints them. `String(x)`, template literals, `console.log` and `toExponential()` gave one digit too many for some doubles, such as `2 ** 89` (`6.1897001964269014e+26` where JavaScript prints `6.189700196426902e+26`); `toFixed` dropped the sign of a negative number that rounds to zero (`-0.000`); and `toString(radix)` of a very large number crashed.
