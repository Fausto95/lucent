---
"@lucent-lang/lucent": patch
---

Present view controllers and system sheets from iOS code and await their result with `present()` from `lucent:ios`: it shows the view controller from the scene in use, settles once, dismisses it however it ends, and rejects with an `AbortError` when a signal aborts, the person swipes it away or its scene goes. Follow the app's and its scenes' lifecycle with `onAppEvent()` and `onSceneEvent()`, without replacing the app's delegates.
