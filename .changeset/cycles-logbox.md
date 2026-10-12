---
"@lucent-lang/lucent": patch
---

After a reload in a debug build, LogBox shows each reference cycle the teardown found, once, as a warning. `__lucentDebug.snapshot()` lists every cycle found so far as `cycles`, and `__lucentDebug.cycles()` gives the cycles found since its last call.
