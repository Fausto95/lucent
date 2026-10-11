---
"@lucent-lang/lucent": minor
---

Add `NativeHandle` to `lucent:core`, and `NativeBuffer.handle()`. A handle gives native code the bytes' address, as VisionCamera's `NativeBuffer` gives Skia one: `pointer` is a bigint, `released` says whether it was released, and `release()` releases it once, from Lucent or JavaScript. Until then the buffer stays borrowed for read, so reads go on while writes, `transfer()` and `close()` throw an `InvalidStateError`. JavaScript gets one object per handle. A handle it drops without releasing is released when collected, and a debug build counts it in `host.releasedOpen`.
