---
"@lucent-lang/lucent": patch
---

`onActivityEvent("newIntent")` from `lucent:android` hears the new intents of a React Native app's Activity, such as a deep link opened while the app runs. React Native's `ReactActivity` hands them to React without calling `super.onNewIntent`, so AndroidX's listener never heard them; Lucent now listens to each React context too.
