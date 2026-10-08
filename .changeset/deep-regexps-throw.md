---
"@lucent-lang/lucent": patch
---

A regular expression nested deeper than the native stack holds throws a `SyntaxError` ("stack overflow") when it is compiled, instead of crashing the app.
