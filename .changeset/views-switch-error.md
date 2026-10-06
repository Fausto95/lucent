---
"@lucent-lang/lucent": patch
---

Report an unexpected `LUCENT_VIEWS` value as an error of `lucent build`, `check`, `dev`, `bench` and `sdk lock` (exit code 1, naming the accepted values) instead of a crash to report.
