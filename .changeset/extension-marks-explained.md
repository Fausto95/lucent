---
"@lucent-lang/lucent": patch
---

`lucent explain LUCENT3018` says what it refuses: Lucent's own `present()`, `onAppEvent()` and `onSceneEvent()` in an app extension's code, and the SDK's own marks (`NS_EXTENSION_UNAVAILABLE_IOS`) only where its bindings record them, which the SDK's symbol graphs don't yet, so Xcode refuses those when it builds the extension. Its example calls `onAppEvent()`.
