---
"@lucent-lang/lucent": patch
---

Assignments follow JavaScript's order: `log += next()` reads `log` before `next()` runs, `box.n = next()` writes the object `box` named before `next()` ran, an element or field target's object and key run once, and `xs[i]! += 1` is accepted as a target.
