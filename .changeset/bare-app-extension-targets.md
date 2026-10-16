---
"@lucent-lang/lucent": minor
---

In a bare React Native app, `lucent init` run again adds the targets of the iOS app extensions the last build recorded that the app's Xcode project lacks, as the Expo plugin does at prebuild: the extension's target under the app's bundle identifier (taken from the app's target, its product name expanded), its files in `ios/<name>/`, and its target in the Podfile. `lucent build` warns while one is missing, and no longer checks an extension's Info.plist or entitlements for the app's own entries. `@lucent-lang/lucent` now depends on `xcode`, the Xcode project editor Expo's config plugins use.
