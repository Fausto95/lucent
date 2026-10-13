---
"@lucent-lang/lucent": minor
---

Bind a Lucent package's pods in an Expo app with no manual step. `expo prebuild` no longer stops with LUCENT3004 at a package's pod that isn't installed yet: it leaves iOS to `pod install` and says so. The config plugin calls Lucent's CocoaPods hook from the Podfile's `post_install`, which builds the modules again once the pods are installed, and adds what that build wrote to the app's Pods project. When an installed pod's module still isn't found, a notice names the pod and how its module binds.
