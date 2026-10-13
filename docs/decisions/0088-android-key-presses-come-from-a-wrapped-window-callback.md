# 0088. Android key presses come from a wrapped window callback, not MainActivity lines

- **Date:** 2026-10-13
- **Status:** accepted

Supersedes [0076](0076-an-app-delegate-and-activity-subscriber.md) for key
events: `onActivityEvent("keyDown" | "keyUp", handler)` hears them
without a forwarding line in the app's `MainActivity`. While a module
listens, Lucent wraps each started Activity's `Window.Callback` in
`LucentWindowCallback`, which passes every call to the callback the window
had. A key event goes to the app's views and Activity first. One they
didn't handle goes to the modules' handlers, on the main thread while
Android waits, and the first that consumes it ends it, before the
window's own handling of volume and media keys. A wrapped window stays
wrapped, a callback with no module listening passes everything on. _Why:_
AndroidX has no key listener, a line in `MainActivity` is one more edit
`lucent init` would make and `lucent doctor` check, and Expo's
`ReactActivityLifecycleListener` has no key events, so an Expo app would
need its own way in. The window's callback reaches every Activity, as
react-native-keyevent's `MainActivity` override does for one. Wrapping it
only once a module listens leaves apps without such a module as they were.
_Changed:_ [T110](../tasks.md#t110)'s Android key events.
