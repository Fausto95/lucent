---
"@lucent-lang/lucent": patch
---

Check a Lucent package's `"compatible"` range against the installed Lucent's version: it was checked against 0.0.3, the bundled compiler's own, so a package that asked for `>=0.1` was refused.
