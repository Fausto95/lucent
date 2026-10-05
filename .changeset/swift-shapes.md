---
"@lucent-lang/lucent": patch
---

Bind the Swift shapes iOS bindings left out. A Swift function type is a TypeScript function both ways: a Lucent function can be passed to Swift or assigned to a closure property, and a Swift function Lucent gets can be called. Tuples are TypeScript tuples labeled as Swift labels them (`[min: number, max: number]`). Factory methods Swift imports as initializers are constructors (`new UIButton(UIButton_ButtonType.system)`, `new UIAlertController(…)`), and the C functions Swift imports as a CoreFoundation handle's members are its members (`cgImage.width`, `new CGColor(r, g, b, a)`). Constructing a class that inherits its initializers from a module no file imports now says which module to import, and a Swift `inout` parameter is skipped with its reason instead of producing a shim that does not compile.
