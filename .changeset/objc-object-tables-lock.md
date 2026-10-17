---
"@lucent-lang/lucent": patch
---

iOS: the process's tables of Objective-C objects for Lucent objects (a delegate made for an object, the native object of a class extending an Objective-C one) are locked. Since each package runs on its own actor, two packages could use them at once.
