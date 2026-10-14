# 0103. An Android override runs while its caller waits, and super calls the base's

- **Date:** 2026-10-14
- **Status:** accepted

A method of a Lucent class extending an Android class that overrides the
base's runs while the caller waits, on the calling thread, holding its
module's actor (`callNow`), whatever it returns. Before, one returning
nothing was a turn of the actor later, as an interface's is.
`super.name(…)` in such a class calls the base's implementation: JNI's
`CallNonvirtual…Method` on the class the Lucent class extends, with the
method looked up there, as Java resolves a `super` call. `super.name`
other than called, and a `super` call that would go through a Kotlin
shim, are refused (`LUCENT1005`, `LUCENT1007`).

_Why:_ what calls an override expects it done when it returns. Android
checks some of them right then: a `Fragment` whose `onCreate` didn't call
`super.onCreate` before returning throws `SuperNotCalledException`, and so
does a `Service`'s or an `Activity`'s. A `BroadcastReceiver`'s process
may go once `onReceive` returns. Objective-C overrides already run this
way (`forward(…, sync)` in `delegates.ts`), and a listener's methods, which
the platform doesn't wait for, stay queued. The nonvirtual call is how
JNI makes Java's `super` call: a virtual one would reach the override
again. Looking the method up on the extended class, not the one that
declares it, keeps an override between them, as Java does. _Changed:_
[platform-bindings.md](../platform-bindings.md#subclassing) and
[native-platform.md](../design/native-platform.md#call-directions).
