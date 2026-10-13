# 0099. A buffer is borrowed as typed elements through spans, not typed arrays

- **Date:** 2026-10-13
- **Status:** accepted

`NativeBuffer` gains `withReadAs(type, read)` and `withWriteAs(type,
write)`. `type` is a typed array's constructor named directly, such as
`Float32Array`. The callback gets a `TypedSpan<Float32Array>`, or a
`MutableTypedSpan` for a write: a span like `ByteSpan`, whose elements
are that array's. It reads them little-endian, with no alignment needed,
and converts writes as the array converts them. It has `length`,
indexing, and for writes `fill` and `set`, from a typed array or an
array. Bytes that aren't a whole number of elements throw a `RangeError`
before the callback runs, as `new Float32Array(buffer)` does.
`Uint8Array` gives withRead's own `ByteSpan`. JavaScript's handle lends
a copy as a typed array of that kind, as its other borrows lend copies.

_Why:_ a span has no `subarray`, `buffer` or methods that make another
view, so the borrow check that keeps a `ByteSpan` inside its callback
(LUCENT3030) covers it unchanged. A typed array lent over the buffer
would make views the check can't follow. Naming the constructor keeps
the element kind known where the code is compiled, which C++ needs.
_Changed:_ [T100](../tasks.md#t100)'s last item; C-BUFFER v1.7.
