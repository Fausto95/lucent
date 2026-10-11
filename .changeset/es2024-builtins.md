---
"@lucent-lang/lucent": minor
---

Use ES2024's library: `Object.groupBy` and `Map.groupBy` group any iterable into a record or a map, `Promise.withResolvers()` gives a promise with the functions that settle it, and `isWellFormed` and `toWellFormed` find and replace lone surrogates. Modules are checked against ES2024, so a `v`-flag regular expression literal type-checks, and a resizable `ArrayBuffer` fails with LUCENT1003 rather than being made fixed-size. `lucent init`'s projects target ES2024.
