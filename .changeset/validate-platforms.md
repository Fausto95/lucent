---
"@lucent-lang/lucent": patch
---

Refuse a `--platforms` target other than `ios`, `android` and `host` (exit code 2) instead of building nothing for it and removing what the last build wrote, and accept `--platforms` in `lucent check`, so `lucent check --platforms host` works on CI without SDKs.
