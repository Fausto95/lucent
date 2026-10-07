---
"@lucent-lang/lucent": patch
---

Reach every Objective-C overload: a factory initializer that takes the same types as another constructor (`NSFileHandle`'s `fileHandleForUpdatingAtPath:`) is a static method named by its Swift labels (`FileHandle.forUpdatingAtPath(path)`), and overloads Swift names alike are named by their selectors (`setDoubleForKey` for MMKV's `setDouble:forKey:`) instead of an unreachable duplicate or `setForKeyForKey`.
