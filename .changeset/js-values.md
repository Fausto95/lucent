---
"@lucent-lang/lucent": minor
---

Add `JSValue` to `lucent:core`: a value JavaScript gives that Lucent code holds without looking inside (another library's object, a callback to hand back, any value), stored in fields, records, arrays and module variables and returned to JavaScript as the same value. Comparing, converting or testing one is refused at compile time; the runtime's host holds the value until the last Lucent reference goes.
