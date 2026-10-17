---
"@lucent-lang/lucent": patch
---

`lucent trace` counts `buffer.copy`, `buffer.allocate` and `buffer.adopt`: their bytes join the copy and allocation totals, which it prints in B, KB or MB. A category of instants alone shows its count (`alloc 2× (4.1 KB)`).
