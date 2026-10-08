# 0054. Lucent makes Swift modules that a build would

- **Date:** 2026-10-08
- **Status:** accepted

A Swift pod's module and a Lucent package's `ios.nativeSources` Swift (`lucent:ios/LucentNative`, the native package's own module) are emitted with `swiftc -emit-module` against the app's pods on first import, keyed by their sources' contents, and a local Swift package is built from a copy of its directory. _Why:_ the diagnostic for an unbindable member says to wrap it in Swift of your own, which was then not callable: these modules exist only after Xcode builds the app, and binding must work before that build, as it does for pods. Building pod targets with `xcodebuild` was rejected: it builds their dependencies (React Native's) for nothing Lucent reads. Reading Xcode's DerivedData was rejected, as for Swift packages on 2026-10-04.
