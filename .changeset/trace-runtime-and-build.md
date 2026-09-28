---
"@lucent-lang/lucent": minor
---

Trace why a call or a build was slow: `LUCENT_TRACE=trace.json` records, off the hot path, how long each call waited for its thread, for the Lucent lock or for a compute worker, how long it ran and how many bytes it copied, each call at its `.lucent.ts` line; `lucent trace --runtime trace.json` merges that with the last build's steps into one trace for Perfetto and prints how long each cause took. On devices, `LUCENT_TRACE=platform` (iOS, Instruments) and `debug.lucent.trace` (Android, Perfetto) send the same spans to the platform's tools.
