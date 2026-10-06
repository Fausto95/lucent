---
"@lucent-lang/lucent": minor
---

Every command's `--json` now writes one JSON document described by a published schema (`explain`, `new module` and `clean` gained one), or is refused with exit code 2 by commands without JSON output (`init`, `dev`, `trace`), and errors under `--json` go to stderr instead of being dropped
