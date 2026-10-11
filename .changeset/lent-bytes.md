---
"@lucent-lang/lucent": minor
---

A synchronous exported function that only reads a `Uint8Array` or `ArrayBuffer` argument now reads JavaScript's bytes in place instead of copying them first: reading its length or elements, iterating it, calling a read-only method (`indexOf`, `join`, `slice`…), making views or copies of it, or passing it to an SDK call. So, as in JavaScript, a write JavaScript makes during the call (in a callback) shows. A function that writes, keeps, returns or passes on the bytes, an async one, and an optional argument still get a copy.
