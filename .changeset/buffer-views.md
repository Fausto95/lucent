---
"@lucent-lang/lucent": minor
---

Add `withReadAs` and `withWriteAs` to `NativeBuffer`, which lend a buffer's bytes as another typed array's elements without copying them: `buffer.withReadAs(Float32Array, (samples) => …)`. The callback gets a `TypedSpan<Float32Array>` (a `MutableTypedSpan` for a write) that indexes, fills and sets like that typed array, little-endian, and stays inside the callback as a `ByteSpan` does (LUCENT3030). Bytes that aren't a whole number of elements throw a `RangeError`. From JavaScript, both lend a copy of that kind, written back after `withWriteAs`.
