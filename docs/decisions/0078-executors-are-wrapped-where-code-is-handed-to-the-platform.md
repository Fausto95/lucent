# 0078. Executors: code goes on one where it is handed to the platform, and keeps only its own state

- **Date:** 2026-10-12
- **Status:** accepted

`executor(label)` from `lucent:thread` makes an executor, a serial thread
of its own that never takes a package's lock: a serial dispatch queue on
iOS and a single-thread `Executor` on Android, which platform APIs that
take a queue or an `Executor` take as it is (it replaces `serialQueue()`
for such APIs). Code goes on an executor where it is handed to the
platform: `on(exec, delegate)` for an object (a delegate, a listener) and
`on(exec, (frame) => …)` for a block or a lambda, as in
`output.setSampleBufferDelegate(on(frames, handler), frames)`; the glue
enters the executor's context directly when the platform calls it. A class
given to `on()` is executor code wherever its instances are, and using one
unwrapped elsewhere is refused. Executor code is checked as a compute
task's is (no module state, promises, `await`, JavaScript callbacks or
main-thread and unknown-thread native code), except that native code of
any thread, or of the executor's own, is allowed. It keeps state only in
its own instances: a member only executor code touches is the executor's,
as [0075](0075-instances-of-exported-classes-as-view-props.md) makes a
member only main-thread code touches the main thread's, and a member module
code also touches is refused. What it produces leaves through a `Channel`,
or as `EventEmitter` events posted to their listeners. Adopting a queue or
an `Executor` the app or an SDK made is left for when a port needs it.
_Why:_ every platform callback entered module code under the package's
lock, so a 60 fps frame delegate queued behind synchronous JavaScript
calls. Wrapping at the hand-off is explicit where it matters, covers
objects and closures alike, and keeps the compiler's check local; a class
that declares its executor would tie it to one, and inferring it from an
API's queue argument depends on pairing arguments the SDK data does not
record. _Changed:_ [T74](../tasks.md#t74).
