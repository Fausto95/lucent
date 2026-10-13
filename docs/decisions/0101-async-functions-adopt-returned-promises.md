# 0101. An async function adopts a returned promise after it finishes

- **Date:** 2026-10-13
- **Status:** accepted

`return p` in an async function, `p` a promise, settles the function's
promise from `p` as JavaScript does: a thenable job, then `p`'s
reaction. It no longer means `return await p`. A coroutine ends with
`co_return co_await lucent::adopt<R>(p)`. Its awaiter takes the
coroutine's promise, destroys the frame as a return does, and never
resumes it. An async function that never awaits returns
`lucent::adoptedPromise<R>(p)`. A return past a `finally` keeps `p` and
runs the `finally` first. A promise of another type than the function's
converts its value with a function the compiler emits. `await` of a value
that isn't a promise waits a microtask (`lucent::later`).

_Why:_ awaiting `p` inside the function let its `catch` blocks see `p`'s
rejection, which JavaScript's never see, and it settled a microtask
sooner. Ending the coroutine from the awaiter is one mechanism for every
return, `Promise<void>` included, whose `co_return` takes no value.
_Changed:_ [T103](../tasks.md#t103); the known gaps in the await order
that `docs/semantics.md` listed.
