---
"@lucent-lang/lucent": patch
---

`adoptHardwareBuffer` and `handleOf(HardwareBuffer)` from `lucent:android` work on Android 8 and later: they looked `AHardwareBuffer_fromHardwareBuffer` up in libnativewindow, which doesn't have it, and threw "needs Android 8" on every device. It's libandroid's.
