---
"@lucent-lang/lucent": patch
---

Let `flatMap`'s callback give a value as well as arrays (`names.flatMap((n) => n ?? [])`), flattening only the arrays as JavaScript does, and use an empty array literal where TypeScript types it `never[]`.
