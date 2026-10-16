# 0130. An extension's bytes parameter takes a Uint8Array, an ArrayBuffer or a NativeBuffer, its bytes in place

- **Date:** 2026-10-16
- **Status:** accepted

What Lucent code passes for a native extension's `bytes` parameter
([T142](../tasks.md#t142)'s borrowed bytes item).

- **What it takes.** A `bytes` parameter, `"read"` or `"write"`, takes a
  `Uint8Array`, an `ArrayBuffer` or a `NativeBuffer` from `lucent:core`.
  Its length parameter gets the bytes' length.
- **No copy.** C gets the view's or the buffer's own bytes, for the call
  alone, as it gets a `Uint8Array`'s today.
- **A NativeBuffer is borrowed.** The call holds a read borrow for a
  `"read"` parameter and a write borrow for a `"write"` one, as
  `withRead` and `withWrite` do. A borrow that conflicts, a closed buffer
  or a read-only one written throws an `InvalidStateError` before the
  call.

_Why:_ a NativeBuffer's bytes are often a camera frame or a decoded file,
and copying them into a `Uint8Array` to call C costs what an extension
exists to avoid. The borrow keeps another thread from closing or moving
the buffer under the call. _Changed:_ T142's item, whose `Uint8Array`
form copied nothing either.
