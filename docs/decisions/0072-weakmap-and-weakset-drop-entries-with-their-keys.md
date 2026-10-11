# 0072. WeakMap and WeakSet drop entries with their keys

- **Date:** 2026-10-11
- **Status:** accepted

`WeakMap` and `WeakSet` are supported, keyed by the objects a `WeakRef` holds (class instances, interface values, object values), by identity, with JavaScript's `get`, `set`, `has`, `delete` and `add` and no iteration. An entry goes, its value with it, with its key's last strong reference, at once: every object records the weak tables it is a key of (one pointer, null for nearly every object), and its destructor drops its entries. A value that holds its own key keeps it, which JavaScript's ephemerons would free: a documented deviation, as `WeakRef`'s timing is. _Why:_ an object-keyed cache or side table is ordinary JavaScript, and the cost 0068 saw is one pointer per object and a branch in its destructor, which no collection pays unless it is used. _Changed:_ supersedes [0068](0068-weakref-not-a-weak-modifier.md)'s refusal of `WeakMap` and `WeakSet`; [TA44](../tasks.md#ta44) (#170).
