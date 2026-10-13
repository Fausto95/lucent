---
"@lucent-lang/lucent": patch
---

Module state is the app's, whichever JavaScript runtime started it: with two React Native instances, `onDestroy` hooks now run when the last one goes, not when the first goes while the second still uses the state. The runtime keeps module state in a native root, ready for code that runs with no JavaScript runtime.
