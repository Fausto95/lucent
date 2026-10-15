---
"@lucent-lang/lucent": minor
---

A package's `lucent.json` declares what its privacy manifest says, in Apple's keys (`ios.privacy`: required-reason APIs and their reasons, collected data, tracking). The build merges every package's into the native package's `PrivacyInfo.xcprivacy`, in a resource bundle of its own, which Xcode's privacy report reads with the app's.
