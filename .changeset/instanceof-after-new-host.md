---
"@lucent-lang/lucent": patch
---

pr: #8
author: @Fausto95

Keep `instanceof` working for Lucent classes after an app reinstalls Lucent without a new JavaScript runtime: new instances now share their class's prototype.
