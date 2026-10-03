---
"@lucent-lang/lucent": patch
---

Let `lucent build --platforms ios` (or `host`) succeed before the app's Android dependencies are resolved: imports of them in Android code are left untyped with a warning pointing to the Android build, instead of failing with LUCENT3004.
