---
"@lucent-lang/lucent": minor
---

Support union aliases that name themselves, for JSON-shaped data: `type Json = null | boolean | number | string | Json[] | { [key: string]: Json }` compiles, where the compiler crashed. Such a value narrows with `typeof` and `Array.isArray`, crosses to and from JavaScript at any depth, goes to compute tasks, and goes through `JSON.parse(text) as Json` and `JSON.stringify`. A recursive alias with type parameters is refused with LUCENT2002.
