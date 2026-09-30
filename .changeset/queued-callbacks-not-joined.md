---
"@lucent-lang/lucent": patch
---

Stop refusing a function passed to `compute` because another module keeps a callback that the platform delivers later (a monitor's handler, a delegate method that returns nothing): such a callback never runs during the task's native calls.
