---
"@lucent-lang/lucent": minor
---

Emit events to JavaScript from code on an executor: capture the module's `EventEmitter` as a `const` (`const ev = events`) and call `ev.emit(…)` in the function or object you hand over with `on()`. The emit copies its arguments and runs in the emitter's module, which calls the listeners, so a frame or sensor callback reports to JavaScript without waiting for the module.
