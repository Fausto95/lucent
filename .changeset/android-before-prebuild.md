---
"@lucent-lang/lucent": patch
---

Check and build an Expo app before `expo prebuild` when it imports Android libraries from its dependencies: those modules stay untyped, named in a warning, and Android is checked once the app has its Android project, instead of failing with LUCENT3004.
