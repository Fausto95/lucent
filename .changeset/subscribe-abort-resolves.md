---
"@lucent-lang/lucent": minor
---

Resolve `subscribe`'s promise when its signal aborts, instead of rejecting with an `AbortError`: aborting is how JavaScript ends a stream, so a `.catch` no longer has to ignore it.
