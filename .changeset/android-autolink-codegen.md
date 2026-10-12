---
"@lucent-lang/lucent": patch
---

Build Android apps on React Native 0.85 and 0.86, and so on Expo SDK 56 and 57. Their autolinking added Lucent's codegen directory, which doesn't exist, and CMake failed with `add_subdirectory given source … which is not an existing directory`.
