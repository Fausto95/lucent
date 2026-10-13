---
"@lucent-lang/lucent": minor
---

`onActivityEvent("keyDown" | "keyUp", (activity, key) => boolean)` from `lucent:android` hears the key presses the app's views and Activity didn't handle, such as a volume key a camera module takes as a shutter. The handler runs on the main thread while Android waits, and true consumes the key before the window's own volume and media handling. While a module listens, Lucent wraps each Activity's window callback, so the app's `MainActivity` needs no lines.
