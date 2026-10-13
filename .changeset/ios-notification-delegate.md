---
"@lucent-lang/lucent": minor
---

Module code hears `UNUserNotificationCenter`'s delegate calls without taking them from the app. `onAppEvent("willPresentNotification", (notification) => …)` from `lucent:ios` answers how a notification that arrives in the foreground is shown (`"banner"`, `"list"`, `"sound"`, `"badge"`). `onAppEvent("notificationResponse", (action, notification, text) => …)` hears the person's response to one. At the first listener Lucent's delegate takes the app's place and forwards every call to the app's delegate, and iOS shows a notification as the modules and the app's delegate asked together, as Expo's notifications module merges them.
