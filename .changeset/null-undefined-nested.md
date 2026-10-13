---
"@lucent-lang/lucent": patch
---

Keep `null` apart from `undefined` everywhere a value comes from JavaScript. A `T | undefined` inside an array, tuple, record, map or set, a callback's result or argument, or a promise's value now refuses `null` with a `TypeError` naming where it was, and a `T | null` refuses `undefined`, as arguments and object fields already did. Before, either was taken there, and code that narrowed the value threw later.
