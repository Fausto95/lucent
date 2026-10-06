---
"@lucent-lang/lucent": minor
---

Support `ArrayBuffer`: make one, `slice` it, view it with `new Uint8Array(buffer, byteOffset?, length?)` and read a view's `buffer`, and take or return one from JavaScript (as a copy, like a `Uint8Array`), so APIs such as MMKV's `set(key, buffer)` and `getBuffer(key)` keep their shape.
