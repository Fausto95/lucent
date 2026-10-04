---
"@lucent-lang/lucent": patch
---

Bind Kotlin function types on Android: a `(Double) -> Unit` parameter, property or result is a TypeScript function instead of the `Function1` class, so a Lucent function can be passed or assigned to it and a Kotlin function Lucent gets can be called. A property of a fun interface's type (any Java interface with one abstract method) now takes a function too, in module code, in a view's setup and as a JSX attribute.
