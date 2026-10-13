# 0087. Lucent stands in front of the app's notification delegate

- **Date:** 2026-10-13
- **Status:** accepted

`UNUserNotificationCenter` has one delegate, which the app or a library
it uses sets at launch. When a module first listens for
`"willPresentNotification"` or `"notificationResponse"`, Lucent's
`LucentNotificationDelegate` becomes the center's delegate, on the main
thread. It keeps the delegate the app had, weakly as the center did, and
forwards every call to it, its own and those it lacks
(`openSettingsForNotification`). A notification in the foreground is
shown with the options the modules and the app's delegate asked for
together. A response reaches the modules, then the app's delegate, whose
completion handler iOS gets. Lucent reads the notifications by key and
links no UserNotifications. A delegate set after the first listener
replaces Lucent's, and a notification that launched the app reaches
modules as `"relaunched"`'s `"notification"`, since iOS gives it to the
delegate before any module runs. _Why:_ Expo's notifications module
shares the delegate the same way, merging its delegates' options, and the
libraries apps use (Expo's, Firebase's, React Native's push library) set
theirs at launch, before any module listens. Becoming the delegate only
once a module listens leaves apps without such a module as they were, and
no swizzling of `setDelegate:` intercepts what the app does. _Changed:_
[T110](../tasks.md#t110)'s notification delegate item.
