---
"@lucent-lang/lucent": patch
---

Read Java string constants holding NUL or characters outside the BMP (emoji) exactly: class files write them in modified UTF-8, which was decoded as UTF-8.
