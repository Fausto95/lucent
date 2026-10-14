---
"@lucent-lang/lucent": minor
---

Bind the members a module adds to `NSObject` in an Objective-C category, such as UIKit's `accessibilityLabel`, `isAccessibilityElement` and `accessibilityActivate()`: once your code imports the module, every object has them, `UIView` included. Their methods keep their labels (Foundation's `value(forKey:)` is `valueForKey`), so they never clash with a subclass's own members. Members a module adds to other classes, a category's class methods and Swift extensions' members aren't bound yet.
