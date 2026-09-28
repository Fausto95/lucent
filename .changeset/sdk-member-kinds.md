---
"@lucent-lang/lucent": patch
---

Give each SDK member name one kind per class hierarchy: a method named like an inherited property now takes its Swift labels, as it already did beside the class's own property (`NSCountedSet.countFor(_:)` instead of `count(_:)`), and a class is not declared as conforming to a protocol whose requirement it declares as a property.
