---
"@lucent-lang/lucent": patch
---

Spreading an object that may be `undefined` or `null` into an object literal adds nothing instead of throwing, and an optional field the spread object leaves unset no longer overwrites the value before it, so `{ ...defaults, ...overrides }` keeps the defaults that are not overridden. An object type's keys keep one fixed order in `JSON.stringify` and in the objects JavaScript receives, now documented as a deviation from JavaScript's creation order.
