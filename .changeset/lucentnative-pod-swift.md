---
"@lucent-lang/lucent": patch
---

iOS: code importing `lucent:ios/LucentNative` (a Lucent package's own Swift) builds once the app's pods are installed. Lucent read its own pod, LucentNative, as a Swift pod to bind, and so compiled the Swift it generates into it (`LucentExports.swift`) without the C entry points it calls: "its Swift could not be made into a module: cannot find type 'lucent_error' in scope". The packages' Swift is bound from their sources, as before the pods were installed.
