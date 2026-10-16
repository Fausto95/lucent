---
"@lucent-lang/lucent": minor
---

A native extension's header can include the libraries its package links (decision 0131): it is read with each `android.prefab` module's `include` directory, from the AAR the app's Android classpath resolved, and with the pods' header search paths and the vendored frameworks' headers. The native package's CMake finds each prefab package by the name its AAR gives. Until Gradle has resolved the classpath, Android is left to the Gradle build, and without an iOS build to read the header instead, nothing is checked until then.
