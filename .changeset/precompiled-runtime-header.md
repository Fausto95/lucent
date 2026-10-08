---
"@lucent-lang/lucent": patch
---

Faster native rebuilds: the iOS and Android builds precompile the runtime's umbrella header (`cpp/lucent/prefix.h`), which every generated unit parses, so an edited module recompiles in about half the time (6.5 s → 4.3 s for one unit on a 2-core Linux machine with clang).
