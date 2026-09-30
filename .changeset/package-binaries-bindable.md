---
"@lucent-lang/lucent": minor
---

Bind the prebuilt frameworks and libraries Lucent packages ship. `lucent:ios/<Module>` now finds the module of a framework listed in `ios.vendoredFrameworks` (an `.xcframework` through its iOS simulator slice), and `lucent:android/<package>` the classes of a jar or AAR listed in `android.libraries`, before the app's Gradle build has resolved its classpath. `lucent sdk show`, `search`, `prefetch` and `coverage` see them too.
