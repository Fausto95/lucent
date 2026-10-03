---
"@lucent-lang/lucent": patch
---

Make `for … of` over arrays of objects, strings or arrays faster: each element is moved into the loop's variable instead of copied.
