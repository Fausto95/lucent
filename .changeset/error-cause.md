---
"@lucent-lang/lucent": minor
---

Support an error's cause: `new Error(message, { cause })`, `super(message, { cause })` in an `Error` class and `new` on one without a constructor keep a cause that is an `Error`, which `e.cause` reads (narrow it with `instanceof Error`). JavaScript gets the cause with the error, and an error from JavaScript keeps its cause when that is an `Error`. A cause of another type is still `LUCENT1003`.
