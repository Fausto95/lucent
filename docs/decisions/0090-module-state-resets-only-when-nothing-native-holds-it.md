# 0090. Module state starts at first use, and a reload resets it only when nothing native holds it

- **Date:** 2026-10-13
- **Status:** accepted; amended by [0093](0093-a-callback-with-no-runtime-fails-as-after-a-reload.md)

The first decision of [T130](../tasks.md#t130). Module state is the
process's, and lives in generations. A generation starts at the first use
of any module: a JavaScript `Host`'s install, as today, a native entry
point's call, or the app's launch for `lucent.json`'s `launch` modules.
Starting it runs every module's top level in import order, each holding
its actor, as `resetModuleState` does today. Started by a native root, it
runs under `RuntimeId` 0.

A generation ends when the last live JavaScript runtime is torn down, and
only while no native root holds the state. A `launch` module holds it for
the process. An entry point holds it from its call until the scope of its
work ends, and an instance the OS made ([T131](../tasks.md#t131),
[T133](../tasks.md#t133)) while it lives. A runtime installed while a
generation lasts shares it, as a second runtime does today. A process that
only native code runs keeps one generation to its end.

`onDestroy` hooks belong to the generation, whoever registers them, and
run when it ends: in the teardown that ends it, last registered first,
each holding its actor. A process that ends runs none.

Work an entry point starts belongs to a scope of that call, under its
actor's root, which the platform's end of the task disposes. Inside an
entry point, and in the turns it posts, the code runs for that call, never
for the last attached JavaScript runtime. The fallback to that runtime
stays for platform callbacks no call made. With no runtime, calling a JavaScript callback or
reading a `JSValue` throws an `InvalidStateError`. An event with no
listener is dropped.

_Why:_ starting at first use leaves an app with no native root as it is
today, since its first use is the install. A reload during development
still starts fresh state. React Native starting, or reloading, while a
background task or a service runs no longer wipes the state that work
uses, and no longer cancels it. Hooks tied to the generation run exactly
when the state they clean up ends. Today they run with the first runtime
even when a second still shares its state. A `launch` module can't run
twice, since iOS takes `BGTaskScheduler` registrations only during
launch, so its state outlives reloads. _Changed:_ the three runtime rules
[native-platform.md](../design/native-platform.md#the-native-root) names:
`Host::create`'s reset, destroy hooks at `RuntimeId` 0, and
`currentRuntime()`'s fallback inside entry points.
