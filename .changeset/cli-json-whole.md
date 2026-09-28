---
"@lucent-lang/lucent": patch
---

Print a `lucent` command's whole output when it goes to a pipe: a large `--json` report (`lucent sdk coverage --json`) was cut after 64 kB on macOS.
