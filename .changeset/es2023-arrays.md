---
"@lucent-lang/lucent": minor
---

Use ES2023's array methods: modules are checked against the ES2023 library, so `toSorted`, `toReversed`, `toSpliced` and `with` copy an array and leave it as it was, and `findLast` and `findLastIndex` search it from the end, as in JavaScript. `lucent init`'s projects target ES2023.
