---
"@lucent-lang/lucent": minor
---

Return bytes to JavaScript without copying them: an `ArrayBuffer`, or a `Uint8Array` over the whole of its buffer, that a function returns and that nothing else holds now hands JavaScript the same bytes, and reports their size to its collector. A buffer a variable, a field or another view still holds is copied as before, so neither side sees the other's writes.
