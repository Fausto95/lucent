---
"@lucent-lang/lucent": patch
---

With two JavaScript runtimes at once (two React Native instances), work module code starts belongs to the runtime whose call started it, so tearing one runtime down (a reload) no longer cancels the other's tasks and timers; the second runtime no longer resets the module state the first is using; and a view command's answer goes to the runtime that sent it.
