---
"@lucent-lang/lucent": minor
---

Bind what a module's Objective-C categories add to any other module's class, as UIKit's `NSIndexPath (UIKitAdditions)` adds `row`, `section` and `item` to Foundation's `NSIndexPath`: an index path has them wherever the program imports UIKit. A category's class methods are the class's static methods (`NSIndexPath.indexPathForRowInSection(row, section)`), and its initializers, which Swift imports from class methods, are too, named by their selectors. Before, only the categories on `NSObject` were bound.
