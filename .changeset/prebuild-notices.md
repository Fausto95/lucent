---
"@lucent-lang/lucent": patch
---

`expo prebuild` no longer prints the Info.plist keys, entitlements, main Activity attributes and Gradle plugins Lucent packages need as missing: the config plugin's build runs before the plugin writes them into the app's files. A bare app's `lucent build` still names what its files lack.
