---
"@lucent-lang/lucent": patch
---

Call more Kotlin shapes on Android: generic members whose type parameters have bounds (`fun <T : Comparable<T>> top(items: List<T>)`), with their defaults left out; assigning a value class property; and Lucent classes implementing a Kotlin interface's suspend members (the async method's promise resumes Kotlin) and members taking or giving value classes. Declarations of a class with a value class property are valid again: its accessors are named `getBest`, not `getBest-JdFk__0`.
