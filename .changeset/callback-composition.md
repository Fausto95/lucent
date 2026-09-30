---
"@lucent-lang/lucent": minor
---

Turn callback APIs, such as a native listener, into promises and subscriptions with `fromCallback` and `subscribe` from `lucent:core`: each settles once, whichever callback or abort comes first, and runs the cleanup you return exactly once.
