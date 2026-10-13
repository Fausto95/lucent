---
"@lucent-lang/lucent": minor
---

In an Expo app, Lucent modules' `onAppEvent` hears what only the app delegate receives on iOS, with no change to the app: Lucent registers itself with Expo's app delegate subscribers when the app loads, as Expo's own modules do.
