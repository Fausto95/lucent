# 0063. An actor per package; the main thread never queues

- **Date:** 2026-10-08
- **Status:** accepted

The single process-wide Lucent lock became one lock and one thread per
import component (an actor: a package, or the app's own modules, unless
they import one another; type-only imports count, since a value of an
imported type can arrive through JavaScript). A long job in one package
no longer delays another, or the main thread. Modules on different
actors share no objects, so the model keeps "a module never races with
itself". Calls across packages happen only through JavaScript or
platform re-entry, and nest the two locks; a fixed lock order was
rejected (JavaScript decides the order), and so was hopping (a
synchronous call needs its result): instead a nested wait that would
close a cycle is detected (a wait-for graph over the threads waiting
nested) and throws `Lucent: deadlock`.

The main thread never takes a ticket: `main(f)`, `present()` and
lifecycle listeners run once their actor is free (retried when it is
released), and a callback that must answer now waits only for the holder
in place, which hands it the lock ahead of queued tickets; debug builds
warn past 50 ms. A synchronous JavaScript callback lends its thread's
actors to the main thread (the suspected deadlock: the JS thread holding
the lock in a callback that waits on `RCTUnsafeExecuteOnMainQueueSync`
while the main thread waits for the lock); a main-thread entry then is
as if the JavaScript had made it. An actor called only synchronously
never starts a thread, and a free actor's lock is taken inline.

Work started by module code belongs to the runtime whose call started it
(a thread-local the posts carry), so tearing one of two runtimes down no
longer cancels the other's work (T64), module state is reset only when
no other runtime is live, and view request ids carry their runtime.
Module variables stay the process's: per-runtime storage would change
every module variable's access.

_Why:_ one lock serialized every package's jobs behind each other and
let the main thread queue behind a long module job. _Limits:_ a reload
whose old runtime is still live when the new one creates its host keeps
the module state (React Native tears the old instance down first;
unverified on devices); a delegate that must answer on the main thread
still waits for the job holding its package then; the iOS and Android
glue changes were compiled only through the generated code's host tests.
_Changed:_ `lucent::Actor` replaces `Scheduler`; generated code names its
actor (`lucent_app::actor_N`) at every entry; `callNow`/`postCallback`
take it; the execution table in [the design overview](../design/overview.md#execution-and-ownership).
