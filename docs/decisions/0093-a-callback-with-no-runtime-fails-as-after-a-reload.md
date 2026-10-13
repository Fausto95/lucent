# 0093. A JavaScript callback with no runtime fails as it does after a reload

- **Date:** 2026-10-13
- **Status:** accepted

Amends [0090](0090-module-state-resets-only-when-nothing-native-holds-it.md),
which said that with no runtime, calling a JavaScript callback or reading
a `JSValue` throws an `InvalidStateError`. Module code holds a callback
or a `JSValue` only if a JavaScript runtime gave it one. With no runtime,
that runtime is gone, as after a reload, and the code fails as it does
then. A callback that returns a promise or a value fails with
`AbortError: The JavaScript runtime is gone`. A `void` one is dropped, as
an event its listeners heard is, since they went with their runtime. A
`JSValue` stays what it was: module code can compare and keep it, and
giving it to another runtime throws a `TypeError`.

_Why:_ the code can't tell a native call's missing runtime from a reloaded
one, and needn't: in both, the runtime that made the callback is gone.
One error keeps module code's handling the same in both, and an
`InvalidStateError` raised only inside a native call would make a
callback's failure depend on who called the code. [T130](../tasks.md#t130)'s
host test checks it. _Changed:_ 0090's line on a call with no runtime, and
[native-platform.md](../design/native-platform.md#the-native-root).
