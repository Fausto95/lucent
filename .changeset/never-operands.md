---
"@lucent-lang/lucent": patch
---

Compile `??`, `||`, `&&`, `??=` and conditional expressions whose other operand always throws, like `value ?? fail("missing")`, and run the throwing operand for `??=` instead of assigning `undefined`.
