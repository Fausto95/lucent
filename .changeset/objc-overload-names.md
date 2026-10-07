---
"@lucent-lang/lucent": minor
---

Reach every Objective-C overload. Initializers TypeScript cannot tell apart are static methods named by their Swift labels, and none of them is the constructor: `NSURL.string(text)` and `NSURL.fileURLWithPath(path)` instead of a `new NSURL(text)` that made a file URL, `FileHandle.forUpdatingAtPath(path)` instead of a `new FileHandle(path)` that only read. Overloads Swift names alike are named by their selectors (`setDoubleForKey` for MMKV's `setDouble:forKey:`) instead of an unreachable duplicate or `setForKeyForKey`. Code calling such a constructor fails to compile until it names the one it means.
