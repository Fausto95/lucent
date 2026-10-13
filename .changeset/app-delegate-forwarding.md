---
"@lucent-lang/lucent": minor
---

`lucent init` has a bare app's `AppDelegate.swift`, and its `SceneDelegate.swift` if it has one, forward URLs, user activities, home screen shortcuts and the push token to Lucent modules' `onAppEvent`: one `LucentAppDelegate` call first in each delegate method the app has, and the methods it lacks, each line ending `// lucent:forward`. `lucent doctor` warns when a call is missing, and `lucent uninstall` removes them. The native package is now a module Swift imports (`import LucentNative`), whose one public header is `LucentAppDelegate.h`.
