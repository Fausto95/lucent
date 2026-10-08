---
"@lucent-lang/lucent": minor
---

Link the C++ runtime's core prebuilt when the package ships it for its runtime (a static library per Android ABI, an iOS xcframework), instead of compiling those sources in every app's native build; `LUCENT_RUNTIME_FROM_SOURCE=1` compiles them as before.
