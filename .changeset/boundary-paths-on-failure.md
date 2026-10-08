---
"@lucent-lang/lucent": patch
---

Cheaper calls from JavaScript: where a value sits (`argument 3`, a record's key, a callback's or a promise's place) is rendered only when its check fails, so a rest argument, a record or a callback no longer allocates a message per value, and an async function looks up `Promise` once per runtime instead of on every call.
