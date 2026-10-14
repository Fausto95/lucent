# 0106. Members a module adds to NSObject are every object's, as a class of the module's own

- **Date:** 2026-10-14
- **Status:** accepted

What a module adds to `NSObject` in an Objective-C category, such as
UIKit's `NSObject (UIAccessibility)`, is bound from the module's extension
graph for ObjectiveC (`UIKit@ObjectiveC.symbols.json`). bindgen gives the
module a class for it, named for both (`NSObject_UIKit`), whose
`extensionOf` is `ObjectiveC.NSObject` and whose `native` is `NSObject`.
It has the category's instance members and no constructor. Its members
are the Objective-C ones: a Swift extension's aren't sent as messages.

The module's declarations declare that class without exporting it, and
augment lucent:ios's `NSObject` to extend it
(`declare module "lucent:ios" { interface NSObject extends NSObject_UIKit {} }`),
so every object of a program that imports the module has the members. A
use sends the message to the object as an `NSObject`, with the module's
header imported, as for any class's member.

_Why:_ apps read a view's `accessibilityLabel`, and every view has it
only through `NSObject`. The members are the module's, so the module's
schema and declarations hold them: a program has them when it imports the
module, as Swift does. A class of the module's own keeps the compiler's
lookup of a member's class as it is, which finds the schema class by the
declaration's class. An augmentation can't add statics, so a category's
class methods, and categories on other modules' classes, are left for
later ([T112](../tasks.md#t112)).
_Changed:_ [limitations.md](../limitations.md),
[T112](../tasks.md#t112), [T121](../tasks.md#t121).
