---
"@lucent-lang/lucent": patch
---

Keep `lucent build` from running small machines and CI runners out of memory: it reads the SDK bindings ahead in one background process per spare core, for the platforms it builds, instead of one process per imported module.
