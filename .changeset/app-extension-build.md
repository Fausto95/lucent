---
"@lucent-lang/lucent": minor
---

`lucent build` now builds each iOS app extension's code: the modules its `ios.appExtensions` declaration's class reaches through its imports, compiled again into `.lucent/native/cpp/generated/ios-extensions/<name>/`, without the JSI units. A new `LucentExtensions.podspec` builds it in a subspec of the extension's name, with the runtime's JSI-free core, under `APPLICATION_EXTENSION_API_ONLY` and `LUCENT_APP_EXTENSION`, which leaves out the runtime's `UIApplication.sharedApplication`, lifecycle observers, Expo subscriber and notification delegate. `LucentNative.podspec` leaves those files out. Lucent doesn't add the extension's target to the app yet.
