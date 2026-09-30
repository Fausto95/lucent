---
"@lucent-lang/lucent": patch
---

`using` declarations: `using file = open(path)` disposes the value with its class's `[Symbol.dispose]()` however the block is left (return, throw, break, continue or the end), in reverse order, skipping `null`. A disposal that throws while another error is pending throws a `SuppressedError`. Classes can define `[Symbol.dispose]()`, the one symbol-keyed member they support; JavaScript doesn't see it. `await using`, and `using` directly in a `case` clause, report LUCENT1001. The editor needs `esnext.disposable` in tsconfig's `lib` (React Native's base config lacks it).
