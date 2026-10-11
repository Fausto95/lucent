---
"@lucent-lang/lucent": minor
---

Use TypeScript's mapped utility types over object types: `Partial`, `Required`, `Readonly`, `Pick`, `Omit` and a `Record` of literal keys are the object types they resolve to, where they failed with "LUCENT2002: \_\_type is not supported". `Object.groupBy` with a key function returning literals now makes that object type, one optional field per key.
