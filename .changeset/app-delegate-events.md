---
"@lucent-lang/lucent": minor
---

Subscribe to what only the app delegate receives on iOS, with `onAppEvent` from `lucent:ios`: `"openURL"`, `"userActivity"`, `"shortcutItem"`, `"pushToken"`, `"pushTokenFailed"`, `"remoteNotification"`, `"backgroundFetch"`, `"backgroundURLSession"` and `"supportedInterfaceOrientations"`, each with its own typed listener and answer. Answers from several modules merge as Expo merges them. A URL, activity, shortcut or push token that comes before any listener waits for the first one. The app's delegates report the events through `LucentAppDelegate`; the next releases add those calls to apps.
