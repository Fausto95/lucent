---
"@lucent-lang/lucent": patch
---

`lucent clean --cache` removes the whole cache projects share: besides the SDK bindings, the memos, compiled Swift modules and Swift packages, generated declarations and packages' compiled Kotlin and Java, which it used to leave. It removes only those entries, so a `LUCENT_CACHE_DIR` holding other files keeps them, and `--json` lists each one with its size.
