# 0084. A class states its native size by implementing NativeSized

- **Date:** 2026-10-13
- **Status:** accepted

The first part of [T107](../tasks.md#t107). A class whose instances hold
native memory the JavaScript collector can't see implements
`NativeSized` from `lucent:core`: a `nativeSize` member, a field or a
getter, giving the bytes. The compiler gives such a class an override
of the runtime's `lucentNativeSize_()`, which reads the member holding
the class's module actor's lock, as a synchronous call would, since the
getter is Lucent code. The JSI host tells the collector that size
(`setExternalMemoryPressure`) each time the instance crosses to
JavaScript, made there or already known, and again after each of its
methods and setters JavaScript calls returns, when it changed since the
last report; Hermes credits and debits the difference, and a size past
32 bits is reported as the most it takes. A `NativeBuffer` reports its
size the same way, and nothing once it is moved or closed. A change made
in module code alone, with JavaScript calling nothing on the instance,
is reported at its next crossing. _Why:_ Nitro reads a
`getExternalMemorySize()` override and Expo's shared objects a
`getAdditionalMemoryPressure()`; an interface to implement says the
same without a method name every class would have to avoid, and the
compiler checks its type. Reading at the crossings and after JavaScript's
calls covers how a size changes in practice without a field on every
object, and taking the module's lock keeps the getter on the module's
code. _Changed:_ [T107](../tasks.md#t107).
