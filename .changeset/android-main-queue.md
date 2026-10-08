---
"@lucent-lang/lucent": patch
---

On Android, work Lucent posts to the main thread is queued in C++ and run by one runnable for all that is waiting, instead of a Java runnable and three JNI calls per post, and checking for the main thread no longer makes JNI calls once it is known.
