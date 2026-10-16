# 0128. An extension's callback runs at once on its context's thread, and is posted from any other

- **Date:** 2026-10-16
- **Status:** accepted

What [0126](0126-an-extensions-callback-runs-where-its-call-ran.md)
decided of where an extension's callback runs, what it returns and what
it throws, changed before any of it was built
([T142](../tasks.md#t142)). Its declarations and lifetimes stay.

- **Where it runs.** A callback belongs to the context its call ran on:
  its module's actor, or another. Called on a thread running that
  context's code, it runs there and then, as a JavaScript callback does.
  That thread is the calling one during the call, or during a later
  extension call made there. Called from any other thread, the callback
  is posted to its context and runs in the order it was called.
- **Results.** A callback may return a number or a boolean, whatever it
  lives for, which C gets when it runs at once. One that would be posted
  is refused instead, and C gets zero. The call it was handed to throws
  the refusal once it returns, if it still runs; otherwise it is reported
  as an uncaught error is.
- **Errors.** What the Lucent function throws can't unwind through C or
  C++. Run at once, C gets zero, and the extension call running on that
  thread throws it once it returns (reported, without one). Posted, it is
  reported as an uncaught error is.

_Why:_ a C library that keeps a callback may call it from a later call on
the same thread: a logger, an emitter's emit, a predicate an object holds.
It expects the callback to run then, as Node's native modules do, and the
thread already holds the context. 0126 posted those calls, and refused a
kept predicate's result. _Changed:_
[0126](0126-an-extensions-callback-runs-where-its-call-ran.md) (its
"Where it runs", "Results" and "Errors").
