---
"@lucent-lang/lucent": minor
---

Tell JavaScript's garbage collector how much native memory an object holds: a class that implements `NativeSized` from `lucent:core` declares `nativeSize`, which Lucent reports on its JavaScript object each time it crosses and after each call JavaScript makes on it, so holding many large objects collects them sooner. A `NativeBuffer` reports its size the same way, until it is moved or closed.
