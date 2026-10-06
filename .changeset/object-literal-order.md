---
"@lucent-lang/lucent": patch
---

Spreading an object that may be `undefined` or `null` into an object literal adds nothing instead of throwing, and an optional field the spread object leaves unset no longer overwrites the value before it, so `{ ...defaults, ...overrides }` keeps the defaults that are not overridden.
