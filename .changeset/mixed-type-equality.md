---
"@lucent-lang/lucent": patch
---

Compile `===`, `!==`, `==`, switch cases, `indexOf`, `includes` and `Map` and `Set` keys between values of different types, as TypeScript allows them: an optional against another optional (`number | undefined` against `string | undefined`), overlapping unions, and a generic's value against `undefined`, `null` or a literal whatever type it is instantiated with. Values that can't be the same JavaScript value are never equal, and unions compare the member they hold. Loose `x == null` in a generic, and `undefined == null` between two optionals, are now true as in JavaScript, and `includes`, `Map` and `Set` find `NaN` inside a union.
