---
"@lucent-lang/lucent": patch
---

Make `JSON.stringify` of a class instance write what JavaScript writes: `private`, `protected` and inherited fields, a subclass's fields through a base-typed value, generic classes' fields, and a `toJSON()` method's value, omitting the property when that value is `undefined`
