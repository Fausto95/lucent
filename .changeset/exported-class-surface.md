---
"@lucent-lang/lucent": patch
---

Use exported classes from JavaScript as JavaScript would: an instance of a class that extends `Error` is `instanceof Error` with its `name`, `message` and `stack`, and is caught in JavaScript as that same instance; static fields are readable and writable on the constructor, which also has its base classes' statics. A public static field whose type can't cross the boundary now reports `LUCENT2006`, as an instance field does
