---
"@lucent-lang/lucent": patch
---

Show why Gradle failed when `lucent build` resolves the app's Android dependencies: the message now gives Gradle's "What went wrong" section for each failure (the dependencies it could not find, or the compiler's errors), up to 20 lines. Before, it gave the last 8 lines of Gradle's output, its generic "Try" advice and "BUILD FAILED".
