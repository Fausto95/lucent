# 0114. A protocol's member is called on its value opened as the type conforming

- **Date:** 2026-10-15
- **Status:** accepted

A member of a Swift protocol with associated types is called on a value
whose type names them (`s: Store<string>`). The shim opens the value from
a variable holding `any Store` into a generic function of its own,
`func opened_<S: Store>(_ s: S)`. Arguments that name an associated type
are cast to it (`as! S.Item`), and the result from it to the type the
receiver's type arguments fix (`as! String`). `Self` is `S`: an argument
is cast to it, and a result comes back as an object, the instance or a
`LucentBox` of the value. A protocol's static members, and members whose
closures take or give an associated type, stay refused
(`associated-types`).

A `mutating` member or a setter of any protocol is called the same way,
on a copy that goes back into the box the value came in. A protocol's
value is read through `lucentUnboxed`, so a Swift struct that conforms
crosses as the protocol's value in the box Lucent holds it in.

_Why:_ `any Store` hides `Item`, so Swift won't call `put(_:)` on it, and
a parameterized `any Store<String>` exists only for primary associated
types and from iOS 16. Opening works on every protocol and iOS version,
and the receiver's type arguments say what the casts are to. A mutating
call on a cast is an error in Swift, and before this a boxed struct read
as a protocol's value failed its cast.
_Changed:_ [T112](../tasks.md#t112), bindgen's `binding-plan.ts`
(`associated-types`), `emit/swift.ts` (`openedCall`, `BOX_HELPERS`),
codegen's `swift/ast.ts` (local and generic functions).
