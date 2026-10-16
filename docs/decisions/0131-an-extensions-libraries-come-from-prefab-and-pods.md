# 0131. An extension's library comes from Gradle prefab and CocoaPods, headers included

- **Date:** 2026-10-16
- **Status:** accepted

How a native extension links a C or C++ library a package doesn't
vendor, as `react-native-mmkv` links MMKV's core
([T142](../tasks.md#t142)'s prefab item).

- **Android.** `android.prefab` maps a Gradle artifact of
  `android.dependencies` to the prefab modules to link:
  `{ "com.tencent:mmkv": ["mmkv"] }`. The native package's module turns
  prefab on. Its CMake finds each artifact's prefab package, by the name
  the AAR's `prefab.json` gives, and links each module into the runtime's
  library. An artifact that isn't a dependency, or a module its AAR
  lacks, fails the build, naming the field.
- **iOS.** A pod of `ios.pods` or a framework of `ios.vendoredFrameworks`
  links as it does today. Nothing more is declared.
- **Headers.** The extension's header is read with the libraries' headers
  on its include path. On Android, those are each listed module's
  `include` directory, taken from the AAR the app's classpath resolved.
  On iOS, they are the pods' header search paths, as the Pods xcconfig
  gives them, and each vendored framework's `Headers`.
- **Before Gradle has run.** A build whose classpath isn't resolved yet
  defers its Android part, as it defers Android's bindings. The extension
  is then read with iOS's headers alone, or after Gradle resolves the
  classpath when there is no iOS build.

_Why:_ a wrapper should link the library its users already get from Maven
and CocoaPods, at the version they pin, not vendor a second copy. Reading
the header against those same headers keeps the binding and the build in
step. _Limits:_ a prefab module's headers are read as the AAR ships them,
for the build's own ABI; one whose headers differ by ABI isn't supported.
