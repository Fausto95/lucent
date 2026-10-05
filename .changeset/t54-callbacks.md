---
"@lucent-lang/lucent": patch
---

Call an arrow function passed straight to `sort`, `map`, `filter`, `forEach`, `reduce` and the like directly, instead of through a function value: `sortNumbers` runs 1.4x faster, and generated code is smaller.
