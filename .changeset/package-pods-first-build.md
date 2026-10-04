---
"@lucent-lang/lucent": patch
---

Build an app whose Lucent package imports a pod its own `lucent.json` declares: the first build now writes the pod into the native package's podspec before it checks the modules, so its LUCENT3004 ("run pod install first") can be followed. `pod install` then installs the pod, and the next build binds it. Before, the failed check wrote no podspec, so `pod install` never installed the pod.
