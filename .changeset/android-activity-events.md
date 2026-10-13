---
"@lucent-lang/lucent": minor
---

`onActivityEvent` from `lucent:android` reports `"configurationChanged"` and `"userLeaveHint"` through AndroidX's listeners, and `"backPressed"` through its `OnBackPressedDispatcher`, the way an app targeting Android 16 hears back presses. A back press handler runs on the main thread and answers whether it consumed the press; one no module consumes goes on as it would without Lucent.
