# 0129. An extension call's AbortSignal is a flag C reads, set as soon as the signal aborts

- **Date:** 2026-10-16
- **Status:** accepted

How Lucent code cancels a native extension's call ([T142](../tasks.md#t142)'s
cancellation item): the function polls a flag, as a C library that can be
stopped already does.

- **Declaration (C).** A `const volatile bool *` parameter is the call's
  signal when `functions.<f>.params.<p>` declares `{ "signal": "flag" }`.
  Lucent code passes an `AbortSignal`, or leaves it out. C reads the flag
  while the call runs, and may not keep the pointer after it returns.
- **C++.** A member's `const std::atomic<bool> &` parameter is the call's
  signal, with no declaration.
- **When it turns true.** As soon as the signal aborts, on whichever
  thread aborts it. That is before the abort reaches the signal's context,
  which a long call may hold. A signal from JavaScript sets it from the
  JavaScript thread before its listener waits for the module.
- **Before and after.** A signal aborted before the call throws its reason
  and makes no call. If the signal aborted during the call, the call throws
  the signal's reason once it returns, whatever C returned. An error struct
  is still released, and a callback's error and C's failure give way to the
  reason.

_Why:_ an abort reaches a signal's listeners on its context, which the
call holds, so only a flag outside the context can stop it. C reads a
plain `volatile` flag without Lucent's types, and C++ reads its own
atomic. Throwing the reason keeps a partial result from passing as a
whole one, as `fetch` rejects. _Limits:_ the flag is read, not waited on:
a C function blocked elsewhere notices it only when it next looks.
