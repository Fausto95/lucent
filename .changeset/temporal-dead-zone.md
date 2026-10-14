---
"@lucent-lang/lucent": minor
---

A `let` or `const` used before its declaration runs throws `ReferenceError: Cannot access 'x' before initialization`, as in JavaScript, where it read as an unassigned value: a hoisted function or an earlier closure called too early, in a function or while a module starts. Only variables such code can reach carry the check.
