---
"@lucent-lang/lucent": minor
---

Android creates a package's launch modules too. In an app whose packages list them, `LucentInitializer` loads the app's `appmodules` library before `Application.onCreate` and React Native, then starts module state. React Native's own load of the library later finds it loaded. An app without launch modules loads nothing early.
