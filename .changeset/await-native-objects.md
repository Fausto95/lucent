---
"@lucent-lang/lucent": patch
---

`await` on a platform SDK object, such as a Play services `Task` or a Java future, is a compile error (LUCENT1010) instead of giving the object back: it is not a promise. Wait for it through its completion listener with `fromCallback` from `lucent:core`, as for any callback API. No library class is recognized by name, so a package's own listener-based types work the same way.
