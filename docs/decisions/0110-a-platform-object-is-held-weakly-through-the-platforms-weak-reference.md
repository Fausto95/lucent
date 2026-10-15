# 0110. A platform object is held weakly through the platform's weak reference

- **Date:** 2026-10-15
- **Status:** accepted

A `WeakRef` to an SDK object, and a `WeakMap` or `WeakSet` keyed by one,
hold the object through its platform's weak reference: ARC's on iOS, a
JNI weak global reference on Android. `deref()` gives the object while
anything holds it, the platform or Lucent, as a new reference; once the
platform frees it, `undefined`. A platform object's identity is the
platform's (pointer identity, `IsSameObject`), so two Lucent references to
one object are one key, found by a hash of that identity
(`System.identityHashCode` on Android).

An entry whose key the platform has freed goes at the table's next sweep,
its value with it. A sweep runs when an entry is added to a table that has
doubled since the last one. An object the platform cannot refer to weakly
(an out-parameter's slot) is a `TypeError`.

_Why:_ a Lucent reference is one of the object's owners, not the object:
a delegate's back reference to a view controller must see the controller
UIKit still holds after Lucent's own references go. A `std::weak_ptr` to
the reference would lose it then. The platform frees the object on its
own schedule (the collector, on Android), so no destructor of Lucent's
can drop its entries at once, as one does for a Lucent object's; a sweep
on growth bounds what dead entries hold without a callback from the
platform.
_Changed:_ [T112](../tasks.md#t112), `lucent/native.h` (`NativeWeakOps`,
`NativeWeak`), `lucent/weak.h`, `lucent/platform/ios.h`,
`lucent/platform/android.cpp`, `types.ts`.
