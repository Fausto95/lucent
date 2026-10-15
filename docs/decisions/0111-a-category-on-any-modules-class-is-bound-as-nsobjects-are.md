# 0111. A category on any module's class is bound as NSObject's are, its class methods merged into the class

- **Date:** 2026-10-15
- **Status:** accepted; extends
  [0106](0106-members-a-module-adds-to-nsobject-are-every-objects.md)

What a module's Objective-C categories add to another module's class is
bound from each of the module's extension graphs
(`<module>@<Other>.symbols.json`), as 0106 binds `NSObject`'s from
`<module>@ObjectiveC.symbols.json`: UIKit's `NSIndexPath (UIKitAdditions)`
is a class `NSIndexPath_UIKit` whose `extensionOf` is
`Foundation.NSIndexPath`, and lucent:ios/Foundation's `NSIndexPath`
extends it. A class the module declares itself is not an extension.

Its class methods are static methods of that class of the module's own,
and the augmentation merges each into the extended class as a namespace's
constant of the method's type
(`namespace NSIndexPath { const indexPathForRowInSection: typeof NSIndexPath_UIKit.indexPathForRowInSection; }`),
so `NSIndexPath.indexPathForRowInSection(row, section)` resolves to the
method's declaration in that class. The initializers a category adds,
which Swift imports from class methods (`NSIndexPath(row:section:)`), are
class methods too, named by their selectors and giving the extended
class's objects: a constructor can be declared only where its class is.
A category's class properties are not bound yet.

_Why:_ table and collection views name their items by `NSIndexPath`'s
`row`, `section` and `item`, which only UIKit's category gives. The
lookup 0106 kept, the schema class of the declaration's class, finds a
class method through `typeof`, since a call's signature keeps its
declaration; a namespace's own function would be a declaration with no
class.
_Changed:_ [T112](../tasks.md#t112), bindgen's `ios.ts` (`withExtensions`,
`extensionGraphs`, `initializersOfExtension`), `provider.ts`, the
compiler's `sdk/dts.ts`.
