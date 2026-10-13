# 0089. The main Activity's attributes are named or written as Info.plist entries are

- **Date:** 2026-10-13
- **Status:** accepted

Supersedes [0076](0076-an-app-delegate-and-activity-subscriber.md) for how
`lucent.json`'s `android.mainActivity` reaches the app. A package asks for
`supportsPictureInPicture`, `configChanges` values and a `launchMode`
there. Packages' asks join: picture in picture if any asks, every
`configChanges` value, and one launch mode, packages asking for two
failing the build. A bare app's `lucent build` names what the launcher
Activity in `android/app/src/main/AndroidManifest.xml` lacks, and the
Expo config plugin writes it into the manifest prebuild makes. The app's
own launch mode stands, and a package that needs another is named. Its
`configChanges` gain the values they lack. _Why:_ the manifest merger
that 0076 named can't add to an attribute the app's manifest already
sets, as `configChanges` is in every React Native template, and fails the
build on any difference instead. The app's manifest is the app's, as its
Info.plist is, so the build names what it lacks the same way. _Changed:_
[T110](../tasks.md#t110)'s `android.mainActivity` item.
