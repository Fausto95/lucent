# 0085. A const keeps one platform object of an executor's callback

- **Date:** 2026-10-13
- **Status:** accepted

Refines
[0081](0081-functions-on-an-executor-share-only-constants-and-channels.md)
and [0082](0082-objects-go-on-an-executor-where-they-are-made.md), which
take `on(executor, x)` only where it is handed to the platform. It may
also be a `const` in a function's body, `const listener = on(executor,
(e) => …)` or `on(executor, new C(…))`, whose every use is an SDK call's
argument or an SDK property's value: called, given to Lucent code, or
kept in a `let`, it is refused (`LUCENT1007`). Wherever it is handed
over, it is one platform object, so a listener added with it is removed
with it, as `removeUpdates(listener)` and `unregisterListener` need. An
object is itself, whose platform object is already one per instance. A
function keeps its executor and what the platform made of it
(`lucent::handedFunction`, `handed.h`): an Android proxy is one per
function and executor while Java holds it, and an Objective-C block is
made at its first hand-over as each block type and kept for the others.
_Why:_ a platform that removes a listener compares it with the one it
was given, and `on()` in each call makes a new one. Keeping the hand-over
the only use keeps 0081's and 0082's rule that nothing but the platform
calls the code, with no new analysis. _Changed:_ [T109](../tasks.md#t109),
and the limitation that a listener on an executor couldn't be removed.
