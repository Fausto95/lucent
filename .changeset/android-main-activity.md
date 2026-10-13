---
"@lucent-lang/lucent": minor
---

A package's `lucent.json` can ask for attributes on the app's main Activity: `android.mainActivity` with `supportsPictureInPicture`, `configChanges` values and a `launchMode`, as react-native-video's picture in picture needs. The Expo config plugin writes them into the manifest prebuild makes, adding the `configChanges` values the app lacks. A bare app's `lucent build` names what its `AndroidManifest.xml` lacks, as it names Info.plist entries. The app's own launch mode stands, and packages that ask for two different ones fail the build.
