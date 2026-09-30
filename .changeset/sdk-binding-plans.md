---
"@lucent-lang/lucent": minor
---

Judge every SDK call by one set of binding rules: a refused call says why and which native declaration it comes from, declarations document what cannot be used, and `lucent sdk coverage` counts it. Native 64-bit integers (Java's `long`, `NSInteger`, `Int64`) no longer round: they are bigints, and enums, option sets and `@IntDef` groups stay numbers that cross exactly or throw `RangeError`; option sets take `0`; Java arrays of any element copy; functions can be assigned to block properties; and a local named like a reserved word (`id`) no longer breaks Android glue.
