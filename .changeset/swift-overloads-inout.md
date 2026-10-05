---
"@lucent-lang/lucent": patch
---

Keep every Swift overload of one name that a Swift overlay gives an Objective-C class: `NSCoder.decodeTopLevelObject(forKey:)` and `RunLoop.schedule(after:tolerance:options:_:)` were dropped beside their first overload. A Swift `inout` parameter is now skipped with its reason, instead of binding the member as if it took a value and generating a shim that does not compile.
