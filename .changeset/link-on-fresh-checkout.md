---
"@lucent-lang/lucent": patch
---

Link the native module in an Android app's first build after a fresh checkout: `lucent build` writes `.lucent/native` before it runs Gradle, and has Gradle read the app's autolinking config again once the package exists. A Gradle build that read that config before the package existed now fails with "build again" instead of shipping an APK without Lucent.
