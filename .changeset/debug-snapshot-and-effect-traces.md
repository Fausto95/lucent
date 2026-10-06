---
"@lucent-lang/lucent": minor
---

See which view bindings run: each effect's runs are trace events at its `.lucent.ts` line, and `lucent trace` lists the bindings that took the most time. In a debug build, `await __lucentDebug.snapshot()` gives the live counts of what Lucent owns and each mounted component's native view tree
