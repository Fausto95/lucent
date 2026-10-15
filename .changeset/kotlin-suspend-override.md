---
"@lucent-lang/lucent": minor
---

A Lucent class can override a Kotlin class's `suspend` member with an `async` method, as a `CoroutineWorker`'s `doWork` is: the generated Java subclass passes the continuation on, Kotlin is told the call suspended, and the method's promise resumes the coroutine with its value or its error. Members that take or give value classes, or take suspend functions, are still refused.
