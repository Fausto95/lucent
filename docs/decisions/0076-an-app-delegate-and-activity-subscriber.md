# 0076. Lucent ships an app-delegate and Activity subscriber, not a delegate

- **Date:** 2026-10-12
- **Status:** accepted

Supersedes [0071](0071-module-hooks-not-app-delegate-hooks.md) for the
events it names; its module hooks stand. What only the app delegate and
the Activity receive reaches Lucent modules through one subscriber Lucent
ships, never a replaced delegate: on iOS, through `onAppEvent`, `openURL`,
`userActivity`, `pushToken`, `remoteNotification` (the handler answers the
fetch result, and answers from several modules merge as Expo merges them),
`backgroundFetch`, `backgroundURLSession` and `shortcutItem`; on Android,
through `onActivityEvent`, `backPressed` (a handler may consume it),
`userLeaveHint`, `configurationChanged` and `keyUp`, beside `newIntent`. In
an Expo app the native package declares an `ExpoAppDelegateSubscriber` and a
`ReactActivityLifecycleListener` in an `expo-module.config.json` the build
writes, which Expo's autolinking registers. In a bare app, `lucent init`
adds one forwarding line per delegate method to `AppDelegate` and
`MainActivity`, `lucent doctor` checks the lines are there, and `lucent
build` names a missing one. `lucent.json` gains the `android.mainActivity`
attributes the manifest merger can carry (`supportsPictureInPicture`,
`configChanges`, `launchMode`). _Why:_ expo-modules-core forwards these to
its subscribers and Android packages get `ReactActivityLifecycleListener`;
Lucent modules had no URL event on iOS and no push token on either
platform, and react-native-video 7 needs `supportsPictureInPicture` on
`MainActivity`. A subscriber is what Expo itself ships: it adds to the
app's delegate rather than replacing it, which 0071 rejected. _Changed:_
[T76](../tasks.md#t76).
