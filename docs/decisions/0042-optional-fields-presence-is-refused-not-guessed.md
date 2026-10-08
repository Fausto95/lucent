# 0042. Optional fields' presence is refused, not guessed

- **Date:** 2026-10-06
- **Status:** accepted

`in`
with an object type's optional field, a computed `in`, `for…in` or
`Object.keys` on a type with one report LUCENT1002 or LUCENT1003; `in`
sees the keys every object inherits from `Object.prototype`. _Why:_ an
optional field is a fixed-layout `Opt<T>` that can't tell unset from
set to `undefined`; a presence bit per field would have to travel
through literals, spreads, `JSON.parse` and the boundary, and reading
`undefined` as absent is wrong for `{ name: maybe }`. _Changed:_
docs/semantics.md (operators, loops, the key order row), the LUCENT1002
and LUCENT1009 explanations.
