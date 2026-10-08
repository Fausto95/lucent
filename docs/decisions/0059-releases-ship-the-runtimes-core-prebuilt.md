# 0059. Releases ship the runtime's core prebuilt

- **Date:** 2026-10-08
- **Status:** accepted

The release workflow builds the part of the C++ runtime that reaches no JSI, React Native or fbjni header (27 of its sources) as a static library per Android ABI and an iOS xcframework (`scripts/prebuilt-runtime.ts`), keyed on the hash of the runtime's sources and flags. An app's build copies it into the native package only when the hash matches, and the podspec and CMake link it instead of compiling those files, falling back to the sources without it or with `LUCENT_RUNTIME_FROM_SOURCE=1`. _Why:_ every app compiled the whole runtime in every clean native build. The JSI and React Native glue stays source, as its ABI is the app's React Native's. _Changed:_ the host target and the Android CMake selection are tested on Linux; the iOS xcframework, the podspec's selection and the NDK builds are unverified until the release workflow's first run on macOS.
