# 0091. Entry points are C functions named for their export

- **Date:** 2026-10-13
- **Status:** accepted; amended by [0094](0094-exports-that-would-share-an-entry-point-get-none.md)

The entry-point ABI of [T130](../tasks.md#t130), the second decision
[native-platform.md](../design/native-platform.md#open-decisions) asked
for. An exported module function whose parameters and result cross
without JavaScript gets a generated C function,
`lucent_<module>_<export>`. The module is its name as JavaScript imports
it, its characters other than letters and digits made `_`, so a name is
stable while the module's path and the export's name are. Two that come
out the same fail the build, naming both. They are declared in one header
the native package ships, `lucent_entries.h`, beside a C API for what
crosses: `lucent_string` (UTF-8 and a length), `lucent_bytes`, and
`lucent_error` (name, message and code).

A synchronous function's entry returns whether it succeeded, with its
result written through the last pointer and its error through the
`lucent_error*` before it. It runs on the calling thread holding the
module's actor, as `callNow` does, and follows the main-thread rule
there. An `async` function's entry takes a completion, a C function and a
context pointer, which Lucent calls once, from the module's context, with
the result or the error. Lucent owns the strings, bytes and errors it
passes. A synchronous entry's stay valid until the calling thread's next
entry call, and a completion's until it returns: a caller that keeps one
copies it.

Each call is a `NativeCall` ([0090](0090-module-state-resets-only-when-nothing-native-holds-it.md)).
It starts module state if no generation lasts, and holds it until a
synchronous call returns or an `async` call's completion runs. Then the
work it started that still runs is cancelled. What crosses at first:
numbers, booleans, `bigint` as `int64_t` (a `RangeError` past it),
strings, `Uint8Array` as bytes, and nothing (`void`). A function with any
other type gets no entry. `NativeBuffer`s, platform objects, structs,
arrays and classes come with
[T114](../tasks.md#t114)'s Swift and Kotlin APIs, which wrap these
functions.

_Why:_ a C function is what Swift, Kotlin through JNI, Objective-C and C++
can all call, and what the glue Lucent generates for
[T131](../tasks.md#t131) to [T133](../tasks.md#t133) calls as well. A
name made from the module and export is one a stored reference (a
WorkManager class, an App Intent) can rely on across updates. Unlike
`callNow`, which reports a throw and returns a default, an entry gives its
error to its caller, since a result the OS reads must not be made up.
Ending a call's work with the call matches how the OS ends a background
task, and keeps a native call from leaking work no one awaits.
_Changed:_ [native-platform.md](../design/native-platform.md#native-entry-points)'s
open question.
