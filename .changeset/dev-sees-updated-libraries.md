---
"@lucent-lang/lucent": patch
---

Bind the version of a native library installed now in `lucent dev` and the editor: after a `pod install` or a rebuilt Swift module, the next rebuild uses its new API instead of the one the process first read.
