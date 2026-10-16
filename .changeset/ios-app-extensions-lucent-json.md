---
"@lucent-lang/lucent": minor
---

`lucent.json` accepts `ios.appGroups`, App Group identifiers (`"group.…"`) the app's entitlements get as `com.apple.security.application-groups`, joining any value a package's `ios.entitlements` gives that key. It also accepts `ios.appExtensions`, the iOS app extensions a package or the app declares (a notification service, a share extension or a widget, naming the Lucent code each runs), which the build checks and merges, naming both packages when two declare one differently; their targets aren't built yet.
