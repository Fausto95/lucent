---
"@lucent-lang/lucent": minor
---

`lucent sdk coverage --update <baseline>` writes the reports into a coverage baseline, each with the SDK it was read from, and `--check` now names the modules it reads that the baseline lacks (which it does not gate) and a baseline that does not say which SDK it was measured with.
