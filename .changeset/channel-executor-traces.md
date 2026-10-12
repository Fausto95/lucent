---
"@lucent-lang/lucent": minor
---

See channels and executors in a runtime trace: each `Channel` records how long its values wait (`channel.wait`), its depth as a counter series of its own, and its drops and refusals, and an executor's spans carry its label, including callbacks the platform runs on it at once (`enter`).
