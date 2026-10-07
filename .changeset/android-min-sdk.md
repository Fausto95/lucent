---
"@lucent-lang/lucent": minor
---

Check Android APIs against the app's own `minSdk`, which the Gradle build now reports with the classpath, instead of always API 24 (still the default before Gradle has run), and bind the Android platform the app compiles against (`compileSdk`) when it's installed rather than the newest one. An app with a higher `minSdk` no longer needs `available()` checks for APIs its devices all have.
