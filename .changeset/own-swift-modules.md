---
"@lucent-lang/lucent": minor
---

Bind Swift pods built as static libraries or frameworks, pods that ship an `.xcframework`, and the Swift in a Lucent package's `ios.nativeSources` (as `lucent:ios/LucentNative`), so a member Lucent cannot bind can be wrapped in Swift of your own and called from Lucent code. Lucent makes each Swift module with `swiftc` on first import, before Xcode has built it, and caches it by its sources' contents.
