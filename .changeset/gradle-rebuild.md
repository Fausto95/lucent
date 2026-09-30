---
"@lucent-lang/lucent": patch
---

When `lucent build`, run by the app's Gradle build, changes the Lucent Android library's `build.gradle` (its first Kotlin shim, a package's Android dependency), it now fails and asks for another build instead of letting Gradle build the library as it was configured, which left new Kotlin shims out of the app.
