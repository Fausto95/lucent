---
"@lucent-lang/lucent": patch
---

Make built-ins that silently differed from JavaScript behave as JavaScript does (`fromIndex`/`start`/`end` and `undefined` optional arguments, `$` patterns in `replace`, `SyntaxError`'s name, `Number.is*` and `Array.isArray` on unions, array lengths, numbers passed to narrower native integers), or refuse them with `LUCENT1003` naming what to use instead (`normalize()`, locale arguments, an error's `cause`, `Object.keys` on object types, arrays with holes, `new Proxy`).
