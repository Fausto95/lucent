---
"@lucent-lang/lucent": minor
---

A native extension's C function can take a callback: declare its function-pointer parameter in `params` as `{ "callback": { "context": "<void * parameter>", "lives": "call" | "once" | "<handle parameter>" } }`, and Lucent code passes a function for it (decisions 0126 and 0128). The callback takes numbers, bigints, booleans and `const char *` strings and returns nothing, a number, a bigint or a boolean. It runs at once when C calls it on a thread running its context's code, during the call or a later one, and is posted to that context from any other thread; one that returns a value is refused there. What it throws is thrown by the extension call once C returns, and a call after it no longer lives does nothing. An undeclared function pointer is still left out, now with what to declare.
