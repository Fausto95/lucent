---
"@lucent-lang/lucent": minor
---

`lucent build` records what adding each iOS app extension's target to the app takes in `.lucent/native/ios-extensions.json`: its subspec of `LucentExtensions.podspec`, its Info.plist (the extension point, its principal class `LucentApp_<module>_<Class>`, the extension's own keys, `NSExtension…` ones as its `NSExtensionAttributes`), its entitlements with the app's App Groups, and a source that links the principal class. A principal class the OS can't make with `init` (missing, not exported, extending no iOS class, or with a constructor or `super()` that takes something) now fails with `LUCENT3019`.
