---
"@lucent-lang/lucent": minor
---

A Lucent class extending an Objective-C class can override the base's properties with a getter, a setter or both, as UIKit asks a view for `intrinsicContentSize` or a view controller for `preferredStatusBarStyle`: the generated subclass's accessors run them while the platform waits, and `super.name` reads and writes the base's. iOS classes' declarations now declare their properties as get and set accessors (only a getter for a read-only one), which TypeScript lets a subclass's accessors override; reading and writing them is as before. A setter for a read-only property, or one for a Swift property, fails with `LUCENT1005`.
