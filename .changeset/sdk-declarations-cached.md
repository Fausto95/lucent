---
"@lucent-lang/lucent": patch
---

Make each `lucent build` and `lucent check` start faster: the declarations of the SDK frameworks a project imports are kept in the SDK cache instead of written again by every run (a check importing UIKit: 1.9 s to 1 s).
