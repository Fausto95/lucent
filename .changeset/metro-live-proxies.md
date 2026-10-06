---
"@lucent-lang/lucent": patch
---

Serve each module's latest proxy from a running Metro: a build that rewrites it needs a reload, not a Metro restart, and a module not compiled yet fails the bundle until a build writes it.
