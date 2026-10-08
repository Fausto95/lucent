# 0068. WeakRef, not a `weak` modifier

- **Date:** 2026-10-08
- **Status:** accepted

Cycles break through JavaScript's own `WeakRef<T>`, for class instances, interface values and objects, rather than a field modifier TypeScript doesn't have: the same source runs as JavaScript, and a delegate keeps its owner as `WeakRef<Owner>`. Reference counting frees the target with its last strong reference, so `deref()` gives `undefined` from then on, where JavaScript keeps the target until its collector runs (a documented deviation). `WeakMap` and `WeakSet` stay refused: a map keyed by object identity that forgets keys has no deterministic counterpart worth its cost yet. A weak reference to an SDK object is not offered either; hold the SDK object strongly and its Lucent delegate weakly. _Changed:_ [TA37](../tasks.md#ta37).
