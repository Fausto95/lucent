---
"@lucent-lang/lucent": minor
---

Bind what a module's Swift extensions add to another module's Objective-C class (SwiftUI's `extension UIColor`, say): the class has the members once you import the module, called through Swift shims, with initializers as class methods named by their labels (`withItemGroup`) or parameter types (`withColor`). A category's or extension's class properties are bound too, as statics of the extended class that can be read and, unless read-only, set.
