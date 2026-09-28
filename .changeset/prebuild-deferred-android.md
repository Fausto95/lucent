---
"@lucent-lang/lucent": patch
---

`expo prebuild` of a fresh checkout no longer stops at LUCENT3004 when a module's Android branch imports a library from the app's dependencies (Play services, AndroidX): until the Gradle build resolves them, those imports are untyped in the iOS build, and the Gradle build's `lucentBuild` task builds and checks Android, reporting an import that is still missing. The first Gradle build after prebuild no longer stops to ask for another build when Android turns out to need Kotlin shims.
