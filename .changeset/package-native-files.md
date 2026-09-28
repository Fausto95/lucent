---
"@lucent-lang/lucent": minor
---

Let Lucent packages ship native files through typed `lucent.json` fields: `ios.nativeSources`, `resources`, `resourceBundles` and `vendoredFrameworks`, and `android.nativeSources`, `resources`, `assets`, `libraries` and `nativeLibraries`. Paths are relative to the package. `lucent build` copies the files into `.lucent/native/packages/<package>/` and adds them to the podspec, the Android library's `build.gradle` and, for C and C++ sources, the runtime's CMake target, so apps need no manual changes to their native projects. Two files that would land in the same place in the app fail the build, naming both packages. The resolved manifest and the build record list each input with its package and a content hash.
