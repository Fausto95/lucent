# 0115. A Swift extension of another module's class is bound as its categories are

- **Date:** 2026-10-15
- **Status:** accepted; extends
  [0111](0111-a-category-on-any-modules-class-is-bound-as-nsobjects-are.md)

The members a module's Swift extension adds to another module's
Objective-C class (SwiftUI's `extension UIColor`, in
`SwiftUI@UIKit.symbols.json`) join the module's extension class
(`UIColor_SwiftUI`), as its categories' members do. They are called
through shims on the extended class (`UIKit.UIColor`), and the shim file
imports the module declaring it. Their methods keep their labels, as the
categories' do. Their initializers are class methods giving the class's
objects, named by their labels (`init(item:group:)` is `withItemGroup`)
or, without any, their parameters' types (`init(_ color: Color)` is
`withColor`).

A category's or extension's class properties merge into the extended
class as the namespace's `const` (read-only) or `let`, typed `typeof` the
extension class's property. The compiler follows that `typeof` to the
property's declaration, so `NSIndexPath.zero` reads it and an assignment
sets it.

_Why:_ SwiftUI, AVKit and the Swift overlays add their Swift API to the
UIKit and Foundation classes apps already hold, and categories' class
properties are class methods Objective-C already calls. A namespace's
variable is the one way to give a class a static from another
declaration file, and its `typeof` keeps the declaration a use needs.
_Changed:_ [T112](../tasks.md#t112), bindgen's `ios.ts`
(`withExtensions`) and `swift.ts` (`factoriesOfExtension`), the
compiler's `sdk/dts.ts` (`extensionDts`), `sdk/declarations.ts`
(`extensionMember`) and `emit/swift.ts` (`extendedClass`), codegen's
`ts/ast.ts` (a mutable namespace variable).
