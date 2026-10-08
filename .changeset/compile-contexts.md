---
"@lucent-lang/lucent": patch
---

Keep each compile's SDK options, native extensions and records of what it read to itself, so the editor plugin's checks and `lucent dev`'s builds in one process never see each other's.
