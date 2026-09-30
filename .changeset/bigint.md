---
"@lucent-lang/lucent": minor
---

Support `bigint`: literals, every operator JavaScript has for it, `BigInt()`, `BigInt.asIntN` and `asUintN`, `Number()` and `String()` of a bigint, and bigints in collections, objects, classes, unions and async code. Values of any size cross the JavaScript boundary exactly, and loose `==` between a bigint and a number or string, which converts in JavaScript, is reported as LUCENT1002.
