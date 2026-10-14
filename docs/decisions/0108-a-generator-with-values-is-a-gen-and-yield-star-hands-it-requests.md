# 0108. A generator with values is a Gen, and yield\* hands it requests

- **Date:** 2026-10-15
- **Status:** accepted

A generator typed `Generator<T, TReturn, TNext>`, where `TReturn` or
`TNext` means something (not `any`, `unknown`, `void`, `undefined` or
`never`), is a `lucent::Gen<T, R, N>`: an `IterObject<T>` that also
takes `send(v)`, `retWith(v)` and gives `result()`. Every other iterator,
generators without values among them, stays an `Iter<T>`, which a `Gen`
converts to. Both are one coroutine promise, `GeneratorPromise<T, R, N>`
(`Undefined` for what a generator leaves out), so `throw(e)` reaches any
generator: `IterObject<T>::throwIn` resumes one throwing `e` where it
waits, and closes another iterator, throwing `TypeError`.

`yield* x` doesn't loop: `co_yield lucent::yieldFrom(x)` hands the
generator's requests (`next(v)`, `throw(e)`, `return()`) to `x`'s
iterator until it is done, and its value is what that iterator returned.
The body resumes only then. A delegate must yield the generator's own
element type, and take the values it takes (or none); otherwise the
compiler refuses it, or, for an iterable without values or result, loops
as before.

Where `TNext` leaves out `undefined`, a `next()` without a value gives
the `yield` the type's default, and a step after the result was reported
gives `TReturn`'s default: an object is unassigned, and throws
`TypeError`. JavaScript gives `undefined`, which the type says it isn't.

_Why:_ one promise type keeps for-of, spread and `Array.from` the same for
every generator, and a typed `Gen` keeps `next(v)`'s value and the result
in their own types, with no union or `any` between them. Delegating the
requests themselves is what JavaScript's `yield*` does: a loop that
re-yields each value could neither pass `next(v)` and `throw()` on nor
give the delegate's result, and it costs a suspension per value. The
defaults follow how an unassigned field reads, the existing answer to a
value the type says is there and JavaScript's leaves `undefined`.
_Changed:_ [semantics.md](../semantics.md), [T106](../tasks.md#t106),
[limitations.md](../limitations.md).
