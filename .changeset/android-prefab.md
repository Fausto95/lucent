---
"@lucent-lang/lucent": minor
---

A package can link a Gradle artifact's prefab modules (decision 0131): `android.prefab` in its `lucent.json` maps an artifact of `android.dependencies` to the modules to link, such as `{ "com.tencent:mmkv": ["mmkv"] }`. The native package turns prefab on, finds each prefab package and links its modules into the runtime's library, so a native extension's C or C++ code can call the library.
