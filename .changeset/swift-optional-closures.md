---
"@lucent-lang/lucent": minor
---

Swift-only members take and give optional closures and tuples: a `((Double) -> Void)?` parameter or property takes a function or `null`, and an optional tuple result reads as one or `null`. A Swift property of a closure type takes a Lucent function, as an Objective-C block property does. Reading an SDK property of a function type after assigning it `null` no longer fails to compile.
