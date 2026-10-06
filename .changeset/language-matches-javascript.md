---
"@lucent-lang/lucent": patch
---

Run more TypeScript exactly as JavaScript does: modules initialize in source order, an Error subclass without a constructor keeps its message and an overridden `name` is kept by its subclasses and `String()`, an exported `let` is read live (one copy per value the module assigns), a read of an object before it is assigned throws `TypeError` instead of crashing, and JavaScript's `null` for a `T | undefined` argument or field fails at the call. Some code that compiled before now reports a LUCENT diagnostic instead of behaving differently from JavaScript: decorators, default exports, and `in`, `for…in` or `Object.keys` on an object type with an optional field (compare the field with `undefined` instead). An exported class with an unsupported member reports it instead of crashing the compiler, and an unknown union discriminant names the accepted values.
