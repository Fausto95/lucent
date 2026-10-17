---
"@lucent-lang/lucent": patch
---

Expo, iOS: an app whose Lucent packages have pods of their own builds in Xcode after `expo prebuild` and `pod install`. Prebuild leaves iOS to pod install's build, so the native package had no entries header when CocoaPods made the pod's public headers, and the exports' Swift API (`LucentExports.swift`) couldn't see the entry points pod install's build then wrote ("cannot find 'lucent_…' in scope"). The header now stands where that build writes it, with no entries until then.
