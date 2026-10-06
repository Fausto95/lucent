---
"@lucent-lang/lucent": patch
---

Run more TypeScript exactly as JavaScript does: modules initialize in source order, an Error subclass without a constructor keeps its message, an exported `let` is read live, a read of an object before it is assigned throws `TypeError` instead of crashing, and JavaScript's `null` for a `T | undefined` argument fails at the call. Decorators, default exports and `in` or `for…in` with an optional field now report a LUCENT diagnostic instead of compiling to different behavior, an exported class with an unsupported member reports it instead of crashing the compiler, and an unknown union discriminant names the accepted values.
