# 0045. A built-in is exact or refused

- **Date:** 2026-10-06
- **Status:** accepted

A built-in that compiled
but differed from JavaScript now follows JavaScript or gives `LUCENT1003`
(a refusal may cover only the arguments Lucent can't honor). Implemented:
`fromIndex`/`start`/`end` arguments, `undefined` for any optional
argument (`Date.UTC` and an error's message included), `split`'s limit
through ToUint32, `$` patterns in string-pattern `replace`,
`SyntaxError`'s name, the message of an `Error` class without a
constructor, `Number.is*` and `Array.isArray`/`instanceof` on unions,
array lengths (`RangeError`, ToLength), device-locale `toLocale…Case`,
and WebIDL's wrapping for numbers passed as narrower native integers.
Refused: `normalize()`, `locales`/`options` arguments, an error's
`cause`, `Object.keys`/`values`/`entries`/`for…in`/`in` on object types,
the forms that make array holes (`new Array(n)` then index assignment
included), `new Proxy`; writing past an array's end or growing its
`length` throws `RangeError` for every element type, where it filled
optional elements with `undefined`. _Why:_ the runtime has no ICU or
normalization tables, Lucent arrays have no holes (and `undefined`
elements are visible where holes are not), and object types record
neither which optional fields are set nor their order; a silent
difference is worse than a diagnostic that names the alternative.
_Changed:_
`docs/semantics.md` (built-ins, error type, platform numbers), the
LUCENT1003 text.
