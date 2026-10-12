# 0074. Lucent supports the current and the previous stable React Native and Expo releases, and a prerelease lane

- **Date:** 2026-10-12
- **Status:** accepted; amended by [0079](0079-react-native-0-85-is-in-the-window-and-no-release-needs-a-fallback.md)

Lucent builds and runs on the current stable React Native release and the
one before it, and on the current and the previous Expo SDK: React Native
0.86 and 0.87, Expo SDK 56 and 57, on 2026-10-11. A prerelease lane runs
beside them, React Native's release candidate and Expo's preview (0.88 RC
and SDK 58 preview on that date), where the example apps stay. The window
moves when a stable release ships: it joins the window, the oldest leaves,
and the prerelease lane moves to the next candidate. Where a release in the
window lacks a React Native feature Lucent uses, the build generates a
fallback for it, chosen by the installed `react-native` version, instead of
refusing the release (an Objective-C++ `RCTTurboModule` provider or a Java
`TurboReactPackage` where pure C++ TurboModule autolinking is missing,
explicit registration where `componentDescriptors` autolinking is). Each
feature Lucent depends on, and the release that first shipped it, is
recorded with the work. CI runs the matrix (bare and Expo apps, on each
release of the window) nightly, as
[0062](0062-device-runs-are-nightly-only-until-they-are-reliable.md) runs
devices. _Why:_ no stable release met Lucent's requirement, and a library
cannot ship on a release candidate: Nitro supports React Native 0.75 and
later, react-native-video 7 asks for 0.75, and authors publish for the
releases their users run. The requirement of 0.88 was recorded nowhere,
and the C++ TurboModules `doctor` named exist in earlier releases. _Changed:_
[T75](../tasks.md#t75).
