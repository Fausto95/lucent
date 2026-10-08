---
"@lucent-lang/lucent": patch
---

Count as JavaScript does past 2^53: a `for` counter stepping by more than 1 (`i += 2147483647`) toward a bound past 2^53 is now a double, whose sums round the same way, instead of an int64.
