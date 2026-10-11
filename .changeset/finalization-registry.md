---
"@lucent-lang/lucent": minor
---

Support `FinalizationRegistry`: `register(target, held, token?)` for class instances, interface values and objects, and `unregister(token)`. A registration's cleanup runs with its held value soon after the target's last strong reference goes, as a job of the code that made the registry, where JavaScript waits for its garbage collector. The docs now say to give a class JavaScript should close a `close()` method, as Hermes has no `Symbol.dispose`.
