---
"@lucent-lang/lucent": minor
---

Native entry points (`lucent_entries.h`) now pass optionals, arrays, `Record<string, T>` and platform objects, as a `lucent_value`: a kind and its value, an `id` on iOS and a `jobject` on Android for a platform object. A value of the wrong kind is a `TypeError`, as from JavaScript. A platform module's iOS or Android file can export a function its declaration file leaves out when the function takes or gives a platform object: native code calls it through its entry point, and JavaScript never sees it.
