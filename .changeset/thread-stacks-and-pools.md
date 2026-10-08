---
"@lucent-lang/lucent": patch
---

Lucent's own threads (the Lucent thread, isolated and compute contexts) now have an 8 MB stack, instead of iOS's 512 KB default for a secondary thread, and on iOS each job they run has an autorelease pool of its own, so objects the platform autoreleases during it are released when it ends.
