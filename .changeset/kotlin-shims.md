---
"@lucent-lang/lucent": patch
---

Call Kotlin libraries' suspend functions, default arguments and value classes on Android through Kotlin shims Lucent generates for what the program uses. A suspend function is a promise, cancelled by the `AbortSignal` it takes last, with thrown exceptions as errors and late results released; leaving out an argument with a Kotlin default lets Kotlin's default apply, and passing `null` passes null. Value classes cross boxed, Kotlin properties with setters can be assigned, and `instanceof` matches Java objects against Android SDK classes, so the cases of a sealed class and their payloads are read as their classes'.
