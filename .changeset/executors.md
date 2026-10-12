---
"@lucent-lang/lucent": minor
---

Run platform callbacks on an executor of their own, never behind module code: `executor(label)` from `lucent:thread` is a serial queue on iOS and a `java.util.concurrent.Executor` on Android, and `on(executor, f)` hands a function to the SDK call that runs it there, checked to share only constants, channels and executors.
