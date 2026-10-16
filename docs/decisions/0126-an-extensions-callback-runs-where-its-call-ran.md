# 0126. An extension's callback runs where its call ran, for as long as its declaration says

- **Date:** 2026-10-16
- **Status:** accepted

How a native extension's function takes a Lucent function to call back
([T142](../tasks.md#t142)'s callbacks item), in a C header or a C++ one
([0125](0125-a-cpp-headers-classes-are-handles-the-generated-cpp-calls.md)).

- **Declaration (C).** A function-pointer parameter is a callback when
  `functions.<f>.params.<p>` declares `{ "callback": { "context": "<q>" } }`,
  with an optional `lives`. `<q>` is the function's `void *` parameter,
  which C passes back as the callback's one `void *` parameter. The
  callback's other parameters are numbers, booleans, bigints (its 64-bit
  integers) and `const char *` strings, copied (a null one is empty).
- **Lifetime (C).** `lives` says how long C may call it: `"call"` (the
  default), until the function returns; `"once"`, until its first call; or
  the name of a handle parameter, until that handle's destroy function has
  returned. Every callback also ends with its module state (a reload).
- **C++.** A `std::function` parameter of a class's member, by value or
  `const &`, is a callback with the same parameter types. It lives as long
  as C++ keeps a copy of it.
- **Where it runs.** A callback runs where Lucent code made the call: its
  module's actor, or the context the call ran on. Called on the calling
  thread while the call runs, it runs there and then. Called from another
  thread, or later, it is posted there and runs in the order it was called.
- **Results.** A callback that returns a number or a boolean runs only
  during the call, on its thread, so in C it must live for the call.
  Called any other way, it is refused: C gets zero, and a call still
  running throws once it returns. Any other callback returns `void`.
- **Errors.** What the Lucent function throws can't unwind through C or
  C++. During the call, C gets zero and the call throws it once it
  returns. Posted, it is reported as an uncaught error is.
- **After the end.** A call that comes once its callback no longer lives
  does nothing, and C gets zero. The Lucent function is released on the
  context it runs on.

_Why:_ Lucent's actors run one job at a time, so a callback can run at
once only on the thread already running the call. Anything else waits its
turn, as an SDK's escaping callback does. C can't say how long it keeps a
pointer, so the package says it, and C++ says it through `std::function`'s
own lifetime. _Limits:_ a callback takes no bytes, handles or objects and
returns no string; cancellation is T142's next item. _Changed:_ C-EXT's
"nothing escapes the call" holds for every parameter but a callback.
