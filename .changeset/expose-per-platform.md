---
"@lucent-lang/lucent": minor
---

Call `expose()` in each `PLATFORM` branch of a one-file component's setup, once per platform, so each platform's commands can use its own view without splitting the component into platform files.
