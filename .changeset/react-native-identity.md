---
"@lucent-lang/lucent": patch
---

Refuse to load Lucent modules into an app whose native code was built against another React Native release than its JavaScript, with a `LUCENT_NATIVE_MISMATCH` error that says which side to rebuild, rather than calling native code built for another release.
