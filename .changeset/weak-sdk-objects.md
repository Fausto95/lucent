---
"@lucent-lang/lucent": minor
---

`WeakRef`, `WeakMap` and `WeakSet` take SDK objects, held through the platform's weak reference (ARC's on iOS, a JNI weak global reference on Android): a delegate can keep its owner, a view controller say, as a `WeakRef` without a cycle, and `deref()` gives the owner while UIKit or Android still holds it. Two references to one SDK object are one key. An entry whose key the platform has freed goes, its value with it, when the table next doubles.
