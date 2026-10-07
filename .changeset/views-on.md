---
"@lucent-lang/lucent": minor
---

Generate native views in every build, in preview: the internal `LUCENT_VIEWS=fabric` switch is gone, so `lucent:ui`, the SwiftUI and Jetpack Compose toolkits and JSX resolve in any program, a package that exports components builds in any app, and `lucent new view` is listed in the help. Drop `LUCENT_VIEWS` from your build scripts: nothing reads it anymore. Views' APIs may still change.
