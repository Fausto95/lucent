---
"@lucent-lang/lucent": patch
---

Metro can bundle a native package that `lucent build --out <dir>` wrote: set `LUCENT_OUT=<dir>` (relative to the project, as `--out` is) and each `*.lucent.ts` file is bundled as that package's proxy, with its loader and build identity, instead of `.lucent/native`'s.
