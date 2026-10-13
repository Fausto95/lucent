---
"@lucent-lang/lucent": patch
---

`lucent build` warns when a module listens for an app delegate event with `onAppEvent` that a bare app's `AppDelegate.swift` or `SceneDelegate.swift` doesn't forward to Lucent. It says to run `lucent init`, or prints the method to add for `"remoteNotification"`, `"backgroundFetch"` and `"supportedInterfaceOrientations"`.
