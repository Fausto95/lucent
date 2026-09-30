---
"@lucent-lang/lucent": patch
---

Compile calls that always throw wherever a value is expected, like `take(fail())`, `s = fail()`, `{ size: fail() }`, `[fail()]`, `1 + fail()` or `if (fail())`, instead of reporting LUCENT2002, and exhaustive switches that pass the value they narrowed away to `assertNever(value: never)`. Templates and calls with several parts no longer give invalid C++ when a part is a call that returns nothing.
