---
"@lucent-lang/lucent": minor
---

The Expo config plugin adds each iOS app extension's target at prebuild, from what `lucent build` records: an app extension of the app's bundle identifier with the extension's name, with the app's version, team, deployment target and devices, embedded in the app, which builds it first. Its Info.plist, entitlements and linking source go in `ios/<name>/`, and the Podfile gets a target naming its `LucentExtensions/<name>` subspec. A target the project or the Podfile has already stays as it is.
