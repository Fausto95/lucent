---
"@lucent-lang/lucent": patch
---

Report a compiler fault in one function as a `LUCENT9002` diagnostic at that function instead of crashing the build, `lucent dev` or the editor plugin, so the rest of the program's diagnostics still show.
