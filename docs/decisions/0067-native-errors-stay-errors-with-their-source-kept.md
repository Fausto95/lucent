# 0067. Native errors stay Errors, with their source kept

- **Date:** 2026-10-08
- **Status:** accepted

A Java exception or an NSError still becomes a Lucent `Error` (its `code` the class name, or `"<domain>:<code>"`), so `catch` and JavaScript see one kind of value; the error now keeps the platform object, and `nativeError(e)` from `lucent:android` or `lucent:ios` gives it back typed (`Throwable | null`, `NSError | null`), for `instanceof` against SDK exception classes and typed `domain` and `code`. Subclassing `Error` per SDK exception was rejected: it would need a Lucent class for every exception the SDK might throw. Async exports now reject bad arguments instead of throwing from the call. _Changed:_ [TA37](../tasks.md#ta37).
