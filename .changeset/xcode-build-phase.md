---
"@lucent-lang/lucent": minor
---

Run `lucent build` in every Xcode build, from a build phase of the `LucentNative` pod, as the Gradle task does for Android: an iOS build is current without Metro or `lucent dev` running. It finds `node` through `ios/.xcode.env`, and Xcode's issue navigator shows the build's problems at their lines. When a build adds or removes a native file, or changes the podspec, the phase fails and asks for `pod install`, since Xcode would otherwise miss the change.
