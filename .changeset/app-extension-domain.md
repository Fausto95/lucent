---
"@lucent-lang/lucent": patch
---

iOS: an API app extensions can't use is recognized however the Swift toolchain spells the symbol graph's domain for them (`iOSAppExtension`, or `iOSApplicationExtension`), so LUCENT3018 still refuses it in an app extension's code.
