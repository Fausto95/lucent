---
"@lucent-lang/lucent": patch
---

Make rebuilds in `lucent dev`, checks in the editor and repeated builds faster: the declarations of the SDK frameworks a module imports are written once per process instead of for every compile.
