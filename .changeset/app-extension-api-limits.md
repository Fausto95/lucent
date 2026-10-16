---
"@lucent-lang/lucent": minor
---

Code an iOS app extension reaches (the modules its `ios.appExtensions` declaration names, and what they import) can no longer use an API the SDK marks unavailable to app extensions, such as `UIApplication.shared`: it fails with `LUCENT3018`, as Xcode refuses it in extension code. So do `present()`, `onAppEvent()` and `onSceneEvent()` from `lucent:ios`. A declaration naming a module its package doesn't have fails with `LUCENT3019`. The SDK schemas record it as `extensionUnavailable`, read from the SDK's `NS_EXTENSION_UNAVAILABLE_IOS`.
