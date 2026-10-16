---
"@lucent-lang/lucent": minor
---

An extension call can be cancelled (decision 0129). A C function's `const volatile bool *` parameter declared `{ "signal": "flag" }`, or a C++ member's `const std::atomic<bool> &` parameter, takes an `AbortSignal` in Lucent (optional when it is last). The flag turns true as soon as the signal aborts, on whichever thread aborts it, and from JavaScript before the abort waits for the module, so a long call can poll it. A signal aborted before the call throws its reason without calling; one that aborts during it throws its reason once the call returns.
