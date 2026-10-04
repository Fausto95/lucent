---
"@lucent-lang/lucent": patch
---

Build a bare React Native app (its `react-native.config.js` links the native package, as `lucent init` sets up) whose Lucent package imports a pod its own `lucent.json` declares: the first `lucent build` now declares the pod in the native package's podspec before it checks the modules, then stops on LUCENT3004 and names the pod, its package and the next steps: `pod install` in `ios/`, then `lucent build`, which binds the pod (and asks for `pod install` again when it adds files). Before, the failed check wrote no podspec, so `pod install` never installed the pod. `expo prebuild` still stops at that first build, which names no steps there.

Ask to relink Android after a Lucent package's Gradle artifacts or `minSdk` change: `lucent build` reported nothing, since it writes them into `build.gradle` before its check.
