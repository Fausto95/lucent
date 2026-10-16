---
"@lucent-lang/lucent": minor
---

A Lucent package's own Kotlin and Java are typed in Lucent (decision 0132): each Java package the `.kt` and `.java` files of its `android.nativeSources` declare is `lucent:android/<package>`, bound from a jar compiled on the build machine the first time one is imported, against `android.jar` and the app's resolved classpath, and cached on the sources' contents. Kotlin compiles with `$KOTLINC`, else the Kotlin compiler the app's Gradle build resolved (which `lucentClasspath` now records), else `kotlinc` on the `PATH`; Java with the JDK's `javac`. Sources that don't compile are LUCENT3004 with the compiler's errors.
