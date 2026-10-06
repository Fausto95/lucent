---
"@lucent-lang/lucent": patch
---

Rewrite the doc comments editors show for `lucent:core`, `lucent:thread`, `lucent:ios`, `lucent:android` and the globals, now also the API reference on the website. They gain the rules that were only in the language spec (a `NativeBuffer`'s errors and what the compiler refuses, when a callback's cleanup runs, that `main()` holds the lock module code shares), and each example is a whole module that compiles.
