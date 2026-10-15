---
"@lucent-lang/lucent": minor
---

Bind a Swift generic type's static methods whose signature names the type's parameters: the call fixes them, so `Box.of(3)` calls `Box<Double>.of(_:)`. Before, only statics whose extension fixed the parameters were bound. A static property of a generic type is still left out.
