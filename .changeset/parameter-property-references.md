---
"@lucent-lang/lucent": patch
---

A constructor body can read and assign its parameter properties' parameters (`constructor(readonly name: string) { log(name); }`), which reported "unsupported reference" before.
