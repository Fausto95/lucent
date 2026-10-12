# 0079. React Native 0.85 is in the window, as Expo SDK 56's release, and no release in it needs a fallback

- **Date:** 2026-10-12
- **Status:** accepted

The oldest React Native in the window is the one its oldest Expo SDK
ships: React Native 0.85 joins 0.86 and 0.87, since Expo SDK 56 pins
0.85.3 (SDK 57 pins 0.86.3, and the SDK 58 preview 0.88's candidate).
Every release in the window has each React Native feature Lucent uses, so
the build generates no fallback. The features, with the first release
that has them (checked in the npm packages of each minor from 0.74, so
"0.74" means 0.74 or earlier):

- Pure C++ TurboModule autolinking on Android: `react-native.config.js`'s
  `cxxModuleCMakeListsModuleName`, `cxxModuleCMakeListsPath` and
  `cxxModuleHeaderName`, which `@react-native/gradle-plugin` reads (0.75).
- Fabric component descriptor autolinking, `componentDescriptors` (0.75).
- The iOS registration, `registerCxxModuleToGlobalModuleMap` (0.74).
- `jsi::NativeState`, and `ArrayBuffer::setExternalMemoryPressure` (0.74).
- The discrete and continuous event categories, `RawEvent::Category`
  (0.74). Through 0.88, continuous maps to React's default priority
  unless the app turns `fixMappingOfEventPrioritiesBetweenFabricAndReact`
  on.
- View recycling: `setupViewRecycling` and `prepareToRecycleView` on
  Android, `prepareForRecycle` on iOS (0.74).
- `enableAccumulatedUpdatesInRawPropsAndroid`, which an app may turn on
  (0.78).
- The Expo config plugin's `withAppBuildGradle`, `withDangerousMod`,
  `withEntitlementsPlist` and `withInfoPlist` (SDK 56).

The props read with `RawProps::at(name)`, new in 0.87, until they took
`at(name, prefix, suffix)`, which every release has. 0.85 to 0.88 build
with the same versions of the libraries their headers include (folly
2024.11.18, fmt 12.1, glog 0.3.5, double-conversion 1.1.6, fast_float 8,
Boost 1.83, fbjni 0.7) and need iOS 15.1. CI compiles Lucent's React
Native C++ against each release's headers (the `rn-releases` harness).
_Why:_ [0074](0074-a-window-of-stable-react-native-and-expo-releases.md)
named React Native 0.86 and 0.87 beside Expo SDK 56 and 57, but an SDK 56
app runs 0.85, so a window without it would leave out the Expo SDK it
names. 0.85 costs nothing 0.86 does not: the same headers break, and the
same fix holds. _Changed:_
[0074](0074-a-window-of-stable-react-native-and-expo-releases.md)
(amended), [T75](../tasks.md#t75).
