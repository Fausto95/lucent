# 0081. Functions on an executor share only constants, channels and executors

- **Date:** 2026-10-12
- **Status:** accepted

Refines [0078](0078-executors-are-wrapped-where-code-is-handed-to-the-platform.md)
for functions, the first part of [T109](../tasks.md#t109) to ship.
`on(executor, f)` is accepted only as the argument of an SDK call, where
the function is handed to the platform (an Objective-C block, a Java
functional interface, a Kotlin function), and `f` is a function literal;
anywhere else `on()` is refused, so no function runs on an executor
except where the platform calls it. `f` is checked with the executor
context of the analysis: module state, computed module constants, code
the compiler can't see, main-thread native code and asynchronous work
(`await`, promises, `main()`) are refused with their cause path, and an
async `f` is refused. Unlike a compute task, `f` may use native code of
unknown thread. A closure on an executor runs beside the code that made
it, not after it, so it captures only `const` numbers, strings, booleans,
bigints, `null` and `undefined`, and `Channel` and `Executor` values,
which both sides may use at once; a `let`, or an array, an object or a
native object, is refused, since the maker could change it while the
executor reads it. When the platform calls `f` on the executor (the
queue or `Executor` it was given), `f` enters the executor's context at
once; called from another thread, a function that returns nothing runs
in a turn of the executor, and one that returns a value is reported as
a callback error, with the platform given a default result. On iOS the
executor is the serial dispatch queue its context runs on, so an API
that takes a queue takes it, and an `NSOperationQueue` may run on it; on
Android it is a `dev.lucent.LucentExecutor`, a
`java.util.concurrent.Executor` whose Runnables run on the executor's
thread outside its turns. `on(executor, delegate)` for objects, and the
executor members of 0078, follow in later parts. _Why:_ the platform's
native facts are unknown for most APIs, and a frame or sensor callback
uses the object it is given (an `ImageProxy`, a `CMSampleBuffer`) from
whatever thread the platform calls it on, as module callbacks already
do; refusing unknown-thread code would refuse nearly every callback,
while refusing main-thread code still keeps UIKit and views off the
executor. Restricting captures to values that can't change keeps the
check local, with no ownership transfer to track, and `Channel` is
already how results leave. _Changed:_ [T109](../tasks.md#t109).
