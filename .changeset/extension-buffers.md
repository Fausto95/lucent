---
"@lucent-lang/lucent": minor
---

A native extension's `bytes` parameter takes a `Uint8Array`, an `ArrayBuffer` or a `NativeBuffer` (decision 0130), and C gets its own bytes, uncopied. A `NativeBuffer` is borrowed for the call, to read or to write as the parameter says, so a borrow that conflicts, a closed buffer or a read-only one written throws an `InvalidStateError` before the call. The declarations import `NativeBuffer` from `lucent:core`.
