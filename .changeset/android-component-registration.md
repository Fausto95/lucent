---
"@lucent-lang/lucent": patch
---

Stop shipping an Android app that crashes on its first component (`UnsatisfiedLinkError` for `LucentViews.update`) after `expo prebuild` on Linux, or before `pod install`. Prebuild lists the components from the iOS build, so without one the first Gradle build read no components to register. That build now asks to build again, as it does when it creates `.lucent/native`, and the next one registers them.
