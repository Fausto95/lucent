---
"@lucent-lang/lucent": minor
---

Lucent generates a C entry point for each exported module function whose parameters and result are numbers, booleans, `bigint`s, strings or `Uint8Array`s: `lucent_<module>_<export>` in `lucent_entries.h`. Native code calls it with or without a JavaScript runtime: it starts module state if none lasts, runs the function holding its module's actor, and gives a thrown error to its caller. An `async` function's entry calls a completion once. Two exports whose entry names come out the same get none, and LUCENT3016 warns. The modules' initializer moved to `lucent_entries.cpp`, which reaches no JSI, so the runtime ABI is 3.
