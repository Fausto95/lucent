---
"@lucent-lang/lucent": minor
---

Add `NativeBuffer.transferToArrayBuffer()`, which moves a buffer's bytes into an `ArrayBuffer` without copying them, from Lucent code and from JavaScript's handle. The buffer is then transferred, as after `transfer()`; the bytes are released as the buffer would have released them, once nothing holds the `ArrayBuffer`. Returned to JavaScript, the `ArrayBuffer` crosses uncopied, so a native buffer reaches JavaScript with no copy.
