---
"@lucent-lang/lucent": patch
---

Declare again, in an SDK class, the superclass methods that an interface it inherits through another interface also declares (`ArrayBlockingQueue.addAll`, from `Collection` through `BlockingQueue`): TypeScript rejected the class for merging two different declarations of one method.
