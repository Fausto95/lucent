---
"@lucent-lang/lucent": patch
---

Build each of the app's Swift packages once when several builds (lucent dev, Metro, a terminal) need it at the same time, instead of each deleting and rebuilding the others' checkout.
