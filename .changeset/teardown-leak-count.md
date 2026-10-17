---
"@lucent-lang/lucent": patch
---

A debug build's count of the native references module code still holds at a reload, and its report of reference cycles, now wait for every actor to run what the teardown left it, each package's disposals and destroy hooks included, rather than for the shared actor alone, which could count references a package's actor was about to release.
