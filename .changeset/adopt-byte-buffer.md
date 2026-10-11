---
"@lucent-lang/lucent": minor
---

Add `adoptByteBuffer(buffer)` to `lucent:android`: a direct `ByteBuffer`'s bytes become a `NativeBuffer`, uncopied, which can move to a worker or, with `transferToArrayBuffer()`, to JavaScript, so a buffer an Android SDK fills reaches JavaScript with no copy. The Java buffer is kept reachable until the bytes are released; a heap or read-only buffer is a `TypeError`.
