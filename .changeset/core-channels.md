---
"@lucent-lang/lucent": minor
---

Add `Channel<T>` to `lucent:core`. It carries values from a producer to a consumer that may run on another thread, such as a compute task sending results to module code as it runs. A send never waits. When the channel is full, its policy decides: `"lossless"` refuses the send, `"latest"` keeps only the newest value and `"drop"` drops the oldest. A send copies its value as a task's input is copied, and a `NativeBuffer` moves. A value the channel drops, or that nobody receives, is released, and a dropped `NativeBuffer` is closed. `receive()` settles on the calling context, and gives `undefined` once the channel is closed and drained. `stats()` counts what was sent, received, dropped and refused. A channel crosses to a compute task as itself, but not to JavaScript.
