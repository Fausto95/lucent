---
"@lucent-lang/lucent": patch
---

Objective-C generic classes are bound: `new NSCache<string, UIImage>()`, `NSHashTable`, `NSMapTable` and `NSLayoutAnchor<AnchorType>` declare their type parameters, and their members pass and return values as the type arguments say (strings, numbers, booleans, data and dates are bridged; objects stay objects).
