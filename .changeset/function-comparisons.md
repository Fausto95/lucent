---
"@lucent-lang/lucent": patch
---

Report comparing two functions as `LUCENT1002` (`LUCENT2002` for a `Map` key or `Set` element), where it used to fail with a C++ error: `===` and `!==` between functions, `indexOf`, `lastIndexOf` and `includes` on arrays of functions, and generics that compare a type parameter instantiated with a function type. Lucent does not keep a function value's identity, so it cannot compare functions as JavaScript does.
