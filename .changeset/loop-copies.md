---
"@lucent-lang/lucent": patch
---

Faster loops: a `for` counter compares with an integer bound (`i < xs.length`) without converting either to a double, and `for … of` over an array of objects or strings, or over a map's entries, reads each element where the collection holds it when the body cannot change the collection, instead of copying it (and an unused key) each iteration.
