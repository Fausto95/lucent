---
"@lucent-lang/lucent": minor
---

An app's root can have a `lucent.json`, with a package's fields, for its own modules' native needs: `Info.plist` keys, entitlements, pods, Gradle dependencies, permissions, manifest components, native sources and launch modules. The build merges it with the packages' and reruns when it changes. Where the app gives a value of its own, such as an `Info.plist` key or a pod's version, the app's wins.
