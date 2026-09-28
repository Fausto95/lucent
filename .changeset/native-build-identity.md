---
"@lucent-lang/lucent": patch
---

The native code `lucent build` generates now carries a build identity: a hash of each target's program, a hash of each module's API (its exports and their signatures), and the runtime ABI they need, which JavaScript can read as `__lucentIdentity` on the Lucent module.
