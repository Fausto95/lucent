---
"@lucent-lang/lucent": patch
---

SwiftUI components read the values their setup passes with checked casts: a value of an unexpected type stops with an error naming the value and the type it held, instead of a bare `as!` cast failure.
