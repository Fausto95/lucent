---
"@lucent-lang/lucent": patch
---

An SDK call, property read or construction whose receiver or argument awaits (`(await file()).getName()`, `Uri.parse(await text())`) compiles: the awaiting operand, and those before it, are evaluated first. It used to emit C++ the compiler refused.
