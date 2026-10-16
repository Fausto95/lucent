# 0123. A runtime that calls Lucent gets a host there, and its creator may give it a scheduler

- **Date:** 2026-10-16
- **Status:** accepted

The first step of [T134](../tasks.md#t134): how worklet runtimes
(`react-native-worklets`' UI runtime, a worker runtime) call Lucent
modules, with no worklet library named in core.

- **Installing.** Worklet libraries carry host functions into their
  runtimes by making them again there from the same C++ function. A
  Lucent function called in a runtime other than the one that made it
  calls through that runtime's host. That host is made at the first such
  call, an _attached_ host, and torn down with its runtime.
  `Host::attach(rt, poster)` (`lucent/jsi/host.h`) lets the runtime's
  creator, or an adapter a package writes, give the attached host a
  scheduler, making the host if it has none. A runtime's host is never
  replaced by attaching.
- **Whose work.** An attached runtime is never the default runtime: work
  a platform callback starts outside any call stays with React Native's.
  Nor does it start or hold a module state generation
  ([0090](0090-module-state-resets-only-when-nothing-native-holds-it.md)):
  a reload resets module state while a worklet runtime lives, and while
  no generation lasts its calls throw as calls do after a reload.
- **Calls.** A synchronous export runs on the calling thread, under its
  module's actor. On the main thread, as the UI runtime calls, it enters
  as main-thread entries do, never with a ticket
  ([0064](0064-an-actor-per-package-and-the-main-thread-never-queues.md)).
  An async export's work belongs to the calling runtime, and its result
  settles through that runtime's scheduler. With no scheduler, it rejects
  at once with a `NotSupportedError`.
- **Its values.** Lucent touches an attached runtime only inside a call
  from it, or in a task its scheduler runs. A callback it gave, called
  later, is posted through its scheduler. With none, it fails as a
  callback with no runtime does
  ([0093](0093-a-callback-with-no-runtime-fails-as-after-a-reload.md)): a
  `void` one is dropped, and one returning a value fails with an
  `AbortError`. A `JSValue` stays with its runtime: giving it to another
  throws a `TypeError`.
- **Instances.** An instance is the process's, and each runtime has its
  own JavaScript object and prototype for it, as each React Native
  instance has. A worklet runtime gets an instance as what a call there
  returns. An object of another runtime's is not an instance there:
  passing one throws a `TypeError`.

_Why:_ remaking host functions is what worklet libraries already do, so
synchronous calls need nothing installed, and core stays free of any
library's names. Only a runtime's creator can post into it, so a
scheduler is its creator's to give, as Nitro's dispatcher is. Keeping the
default runtime and module state with React Native's runtime means a
worklet runtime never decides when module state resets or whose work a
callback is. _Limits:_ async exports and later callbacks on a worklet
runtime need its scheduler. A class can't be constructed in a worklet,
since the proxies' class wrapper is JavaScript.
_Changed:_ [native-platform.md](../design/native-platform.md#worklet-runtimes)'s
open items, and T134's first item.
