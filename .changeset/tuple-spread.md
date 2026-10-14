---
"@lucent-lang/lucent": minor
---

Spread a tuple into a call's parameters, as TypeScript allows: `add(...pair)` passes an argument per element, into fixed parameters, a rest parameter, `push` and `Math.min`/`Math.max`. A tuple also spreads into array literals, and `Array.from`, `new Set` and the like take one. Spreading into an SDK call is still refused.
