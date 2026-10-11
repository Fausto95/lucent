---
"@lucent-lang/lucent": minor
---

Support `WeakMap` and `WeakSet` keyed by class instances, interface values and objects: `get`, `set`, `has`, `delete` and `add`, by identity. An entry goes, its value with it, as soon as nothing else holds its key, as a `WeakRef`'s target does. As in JavaScript they cannot be iterated; they don't cross to JavaScript, and `new WeakMap(entries)` is refused (make one empty and set the entries).
