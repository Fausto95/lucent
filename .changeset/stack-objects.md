---
"@lucent-lang/lucent": patch
---

Fewer allocations: an object literal held by a local that only reads and writes its fields (it is never passed, returned, captured, compared or spread) lives on the stack instead of the heap, so a loop making small objects such as `{ x, y }` runs about four times faster.
