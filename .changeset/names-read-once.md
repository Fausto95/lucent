---
"@lucent-lang/lucent": patch
---

Make builds, checks and the editor faster when modules import iOS frameworks: the names of the frameworks they reference are read from the SDK cache once per build instead of once per lookup.
