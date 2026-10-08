---
"@lucent-lang/lucent": minor
---

Add `serialQueue(label)` to lucent:ios, a new serial dispatch queue for delegates that should not run on the main thread (a camera's sample buffers), and `withPixelBytes(pixelBuffer, f, plane?)`, which calls `f` with a CVPixelBuffer plane's bytes, stride, width and height, read under the buffer's lock.
