---
"@lucent-lang/lucent": minor
---

Hand a platform object's address to native code that takes a pointer, such as a frame processor: `retainedHandle(object)` from `lucent:ios` gives a `NativeHandle` that holds the object retained, and `handleOf(buffer)` from `lucent:android` one that holds a direct `ByteBuffer` (a heap one throws `TypeError`) or acquires a `HardwareBuffer`'s `AHardwareBuffer`. Each lets go of it once, at `release()` from Lucent or JavaScript, or with the handle's last reference.
