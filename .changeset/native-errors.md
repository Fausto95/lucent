---
"@lucent-lang/lucent": minor
---

Read the platform's own error with `nativeError(e)` from `lucent:android` (the `Throwable`, for `instanceof IOException` and its members) and `lucent:ios` (the `NSError`, with typed `domain` and `code`), instead of matching strings in `errorCode(e)`.
