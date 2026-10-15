---
"@lucent-lang/lucent": minor
---

A Swift `async` initializer is a static factory returning a promise of the object, named after its labels: `init(contentsOf:) async` is `await Model.withContentsOf(url)`, and `init() async` is `await Model.make()`. A Lucent class implements an `async` or throwing Swift property requirement with a getter, which returns a promise for an `async` one and may throw.
