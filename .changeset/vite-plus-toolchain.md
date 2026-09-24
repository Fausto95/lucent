---
"@lucent-lang/lucent": patch
---

pr: #7
author: @Fausto95

Build the CLI and compiler with Vite+ (tsdown on Rolldown) instead of esbuild: the published package keeps the same files, and its JavaScript is about 5% smaller.
