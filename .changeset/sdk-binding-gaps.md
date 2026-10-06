---
"@lucent-lang/lucent": patch
---

Add the `@RequiresPermission` permissions of a property's getter to the manifest when the code reads it and of its setter when the code assigns it, and count generated Kotlin in the build identity, so an app built from older Kotlin is reported as stale instead of running it. `lucent sdk show` keeps members' doc comments, `sdk show` and `sdk search` find `lucent:swiftui` and `lucent:compose` declarations with views on (and say why not without), and generated declarations name Objective-C protocols as such and document Swift async members of a main-actor class as callable from any thread.
