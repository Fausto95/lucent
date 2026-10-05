---
"@lucent-lang/lucent": patch
---

Declare the initializers an iOS class inherits through a superclass that inherits them too (`init(coder:)` on `UIWindowScene.ActivationAction`) on every build, not only when the SDK's classes happen to be read in order
