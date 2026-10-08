---
"@lucent-lang/lucent": patch
---

Append to a string field or module variable in place: `this.log += x` and `total += x` on a module variable no longer copy the whole string each time, so building one in a loop is linear. Template literals with several parts build their result with one allocation.
