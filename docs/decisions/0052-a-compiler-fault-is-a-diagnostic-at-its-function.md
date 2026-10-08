# 0052. A compiler fault is a diagnostic at its function

- **Date:** 2026-10-08
- **Status:** accepted

An IR verifier or builder error, which used to stop the whole build with a stack trace, is now `LUCENT9002` at the function it was lowering: the other functions still compile, so the rest of the diagnostics stay accurate, and no invalid C++ is written. Options and records a compile reads (SDK paths, extensions, files read, SDK uses) moved from module state into a per-compile context (`compile-context.ts`), so the editor plugin's checks and `lucent dev`'s builds in one process cannot see each other's. A random-program differential fuzzer (`pnpm test:fuzz`) joins the e2e cases; it is opt-in (`LUCENT_FUZZ=1`) rather than on every CI run, since each program costs a native build.
