---
"@lucent-lang/lucent": patch
---

Android `AutoCloseable` objects (a `Closeable`, a `Cursor`, anything that implements either) are disposable: `using cursor = resolver.query(…)` closes the cursor however the block is left, and `cursor[Symbol.dispose]()` closes it too.
