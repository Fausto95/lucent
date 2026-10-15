---
"@lucent-lang/lucent": minor
---

A Lucent package declares the Gradle plugins its Android code needs in `lucent.json`'s `android.gradlePlugins`: plugin id → the artifact that has it (`"com.google.gms.google-services": "com.google.gms:google-services:4.4.2"`). Packages naming one artifact get its highest version; two artifacts for one id fail the build, naming both packages. The Expo config plugin puts the artifact on the buildscript classpath in `android/build.gradle` and applies the plugin in `android/app/build.gradle`, keeping what the app has. In a bare app, `lucent build` names each line the build files lack.
