---
"@lucent-lang/lucent": minor
---

Stop what module code started for its state with `onDestroy(hook)` from `lucent:core`: the hook runs before a JavaScript reload initializes the module again, and when the runtime goes, so SDK observers no longer pile up across reloads.
