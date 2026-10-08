---
"@lucent-lang/lucent": patch
---

Make `x ?? d` and `x ??= d` test the value when `x`'s type is a type parameter (`orDefault<number | undefined>(undefined, 7)` gives 7, where it gave `undefined`), and compile `??=` on a variable that can't be absent instead of crashing the compiler.
