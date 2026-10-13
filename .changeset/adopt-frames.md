---
"@lucent-lang/lucent": minor
---

Adopt a camera or decoder frame as a `NativeBuffer` without copying it: `adoptPixelBuffer(pixelBuffer, plane?, access?)` from `lucent:ios` and `adoptHardwareBuffer(buffer, access?)` from `lucent:android` (Android 8 and later) lock the frame for the CPU until the buffer's bytes are released. With `"read"`, the default, the buffer is read-only: a write or `transferToArrayBuffer()` throws `InvalidStateError`. With `"readwrite"` it is writable and moves to JavaScript as an `ArrayBuffer`, uncopied.
