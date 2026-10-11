---
"@lucent-lang/lucent": minor
---

Recursion that fills the native stack now throws JavaScript's `RangeError: Maximum call stack size exceeded`, which code can catch, instead of crashing the app: every function that calls other code checks the stack on entry, in Release builds too (a load and a compare; define `LUCENT_NO_STACK_CHECK` to compile it out). Generated code with recursion that never ends, which clang's `-Winfinite-recursion` made an error in device builds, now compiles.
