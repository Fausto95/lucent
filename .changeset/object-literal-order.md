---
"@lucent-lang/lucent": patch
---

Spreading an object that may be `undefined` or `null` into an object literal adds nothing instead of throwing, and an optional field the spread object leaves unset no longer overwrites the value before it, so `{ ...defaults, ...overrides }` keeps the defaults that are not overridden. `Object.keys` and `for…in` over an object type leave out the optional fields that are unset, as `JSON.stringify` and the JavaScript boundary already do. An object type's keys keep one fixed order, now documented as a deviation from JavaScript's creation order.
