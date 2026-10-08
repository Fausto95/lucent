---
"@lucent-lang/lucent": minor
---

Pass a number where an SDK method takes a 64-bit integer (a Java `long`, a Swift `Int`): `vibrate(40)` instead of `vibrate(40n)`, checked to be a safe integer, while results stay bigints.
