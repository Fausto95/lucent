---
"@lucent-lang/lucent": patch
---

Android: the Kotlin API of an async export or method that resolves to nothing compiles. Its `awaitEntry` call named no type argument, which Kotlin can't infer from a statement ("Not enough information to infer type argument for 'T'"), so the bare example's Android build failed.
