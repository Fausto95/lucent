# 0083. Code on an executor emits through emitters it holds, posting to their module

- **Date:** 2026-10-13
- **Status:** accepted

Carries out the events part of
[0078](0078-executors-are-wrapped-where-code-is-handed-to-the-platform.md).
`EventEmitter` joins the values code on an executor may share with its
maker
([0081](0081-functions-on-an-executor-share-only-constants-and-channels.md),
[0082](0082-objects-go-on-an-executor-where-they-are-made.md)): a
function captures one as a `const`, and an executor class's constructor
takes one. A `const` of such a value (a channel, an emitter, an
executor) holds a reference copied where the closure was made, so it
may name module state, as `const ev = events` names a module's exported
emitter: the analysis records what it reaches through such a `const` as
module state reached through an alias, which code on an executor may
use and every other context still may not. An `emit` written in code on
an executor (an `on()` function, an executor class's methods, or a
closure in them) copies its arguments as a channel's send does and
emits in a turn of the emitter's module, where its listeners run, Lucent
and JavaScript alike; the executor waits for none of it, and its emits
arrive in order. Executor code calls nothing else on an emitter, and an
`emit` in a helper it calls stays code that runs the listeners, which
it refuses. _Why:_ an emitter's listener lists belong to its module's
actor, and a module's emitter is assigned again when JavaScript
reloads, so executor code may neither run the listeners nor read the
module's variable; holding a reference its maker copied, and posting,
touches neither. A syntactic place for the posting `emit` keeps one
function's emits the same wherever it runs: an `emit` in code that both
an executor and its module run would otherwise be synchronous in one and
posted in the other. _Changed:_ [T109](../tasks.md#t109).
