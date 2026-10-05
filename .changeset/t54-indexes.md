---
"@lucent-lang/lucent": patch
---

Read uint32 values back out of a `number[]` without mispredicting (`crc32` runs 1.8x faster), and index arrays with a `number` without a C library call on x86-64 hosts without SSE4.1, which made `sieve` far slower on Linux CI.
