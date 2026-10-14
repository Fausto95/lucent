---
"@lucent-lang/lucent": minor
---

Support `crypto.getRandomValues` and `crypto.randomUUID`, from the platform's secure generator (`arc4random_buf` on iOS, `getrandom` on Android). Past 65536 bytes, `getRandomValues` throws an `Error` named `QuotaExceededError`; an array of floats is refused (`LUCENT1003`). `crypto.subtle` is not available.
