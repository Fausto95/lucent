---
"@lucent-lang/lucent": patch
---

Give each iteration of a `for (let …)` loop its own copy of the variable even when the loop's body assigns it, so closures made in different iterations no longer share one variable (`for (let i = 0; i < 6; i++) { fns.push(() => i); i++; }` gives 1, 3, 5, as in JavaScript).
