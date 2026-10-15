# Swift shims

How Lucent code calls iOS APIs only Swift can call (CryptoKit, StoreKit 2,
the Swift overlays of Foundation and UIKit), as built. The glue is
Objective-C++, so it calls a generated `@_cdecl` function for each Swift
member a program uses. [platform-bindings.md](../platform-bindings.md)
covers the rest, and lists what is refused ([T112](../tasks.md#t112)).

```ts
import { SHA256 } from "lucent:ios/CryptoKit";

export function digest(bytes: Uint8Array): Uint8Array {
  return SHA256.hash(bytes).bytes;
}
```

## What the schema says

`addSwiftDeclarations` (`packages/bindgen/src/swift.ts`) reads the
Swift-only declarations of a symbol graph (USRs starting `s:`) into the
same schema as Objective-C ones. A type has `swift: { kind }`, a member
`swift: SwiftMember`: its Swift name (`distance(to:)`, `init(x:y:)`), from
which the call is written, and whether it is `async`, `throws` or
`mutating`.

| Swift declaration                                       | Schema                                                                                                       |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| A struct or class                                       | A class whose `native` is the qualified name (`CryptoKit.AES.GCM.SealedBox`)                                 |
| An enum without payloads                                | An enum of its cases' indexes; its members are skipped                                                       |
| An enum with payloads                                   | A class with `swift.cases`, each case's labels and types; members skipped                                    |
| A protocol                                              | An interface; its associated types are type parameters (`associatedTypes`, `primaryAssociatedTypes`)         |
| A Swift member of an Objective-C class                  | Joins the class; an Objective-C member of the same name wins                                                 |
| A Swift extension of another module's Objective-C class | Joins the module's extension class (`UIColor_SwiftUI`), labelled; initializers are class methods (`withRed`) |
| A top-level function or variable                        | A module function or constant                                                                                |

- **Standard protocols.** `some P`, or a type parameter constrained to
  `P`, takes the one Lucent type that conforms (`STANDARD_PROTOCOLS` in
  `symbols.ts`). `some DataProtocol` is a `Uint8Array` (as `Data`),
  `some StringProtocol` a string, `some Collection<E>` an `E[]`: a rule
  per protocol, not per API.
- **Protocol extensions** of the type's own module give it members
  (`SHA256.hash(data:)`, from `HashFunction`), with `Self.Digest` resolved
  through its typealiases. The standard library's are left out.
- **Statics of generic types** bind when their extension fixes the type
  parameters (`where Root: AVAsset`), as `ownerArgs`. A static method
  whose signature names each of them binds too: its call fixes them
  (`Box.of(3)` is `Box<Double>.of(_:)`). A static property otherwise is
  left out.
- **Defaults.** Trailing default arguments are optional. One whose type
  has no Lucent value (`isolation: isolated (any Actor)? = #isolation`) is
  never given.
- Initializers TypeScript cannot tell apart become static factories
  (`withService`, `withInt`). A `ContiguousBytes` type gets a `bytes`
  property that copies its bytes out.
- **Subscripts** are methods: `subscript(row:)` is `subscript`, and when
  it can be set, `setSubscript`, whose last parameter is the new value
  ([0113](../decisions/0113-a-swift-subscript-is-the-methods-subscript-and-setsubscript.md)).
  Their shims read and write `self[row: a0]`.
- Bridged value types (`URL`, `Date`) stay their Objective-C classes or
  Lucent values. Parameter packs, `inout` parameters, failable and generic
  initializers are skipped with the reason.

## How a call crosses

`emit/swift.ts` registers one `@_cdecl("lucent_swift_<hash>")` shim per
member, role, argument types and type arguments, hashed so a member keeps
its symbol (overloads Swift names alike, `subscript(_:)` of an `Int` and of
a `String`, get one each). All go into `.lucent/native/cpp/generated/ios/LucentShims.swift`,
and the glue declares each `extern "C"`. Values cross as the Objective-C
values the glue already converts: one set of conversions serves both.

| Lucent value                     | Crosses as                                                        |
| -------------------------------- | ----------------------------------------------------------------- |
| A number or boolean              | Its C scalar (`SWIFT_SCALARS`: `Double`, `Int`, `Int64`, `Bool`…) |
| An optional number or boolean    | An `NSNumber`, nil for none                                       |
| A Swift enum without payloads    | `Int`, the case's index                                           |
| An Objective-C enum              | `Int`, its raw value (`E(rawValue: .init(truncatingIfNeeded:))`)  |
| A string, bytes, a date          | `NSString`, `NSData`, `NSDate`, which Swift bridges               |
| An array or record               | `NSArray`, `NSDictionary`, element by element when needed         |
| A Swift class instance, an `id`  | The object itself                                                 |
| A Swift struct                   | A `LucentBox` holding it                                          |
| A Swift enum with payloads       | An `NSDictionary` of its case ([Enums](#enums))                   |
| A protocol value                 | The existential `as AnyObject`, read back `as! any P`             |
| A C struct (`CMTime`, `CGPoint`) | Its bytes as `NSData`, read with `loadUnaligned`                  |
| A tuple                          | An `NSArray` of its elements' objects                             |
| A Lucent function                | An Objective-C block, cast with `unsafeBitCast`                   |

Objects cross as `UnsafeMutableRawPointer`. Arguments are borrowed: the
glue holds them in locals for the call and passes them `__bridge`, and the
shim reads them with `takeUnretainedValue` (`lucentObject`). Results are
retained (`lucentRetained`, `passRetained`), and the glue takes them with
`__bridge_transfer`. A shim, roughly:

```swift
@_cdecl("lucent_swift_9f3c…")
public func lucent_swift_9f3c…(_ self_: UnsafeMutableRawPointer, _ a0: UnsafeMutableRawPointer) -> Double {
  let v = (lucentObject(self_) as! LucentBox<Shapes.Point>).value
    .distance(to: (lucentObject(a0) as! LucentBox<Shapes.Point>).value)
  return v
}
```

A synchronous `@MainActor` member gets an `@MainActor` shim; the
main-thread rule already makes the glue call it on the main thread.

## Boxing

`LucentBox<Value>` is a `final class` subclass of `NSObject` with a `var
value`, which Lucent holds like any object. Member shims read and write
through it, so `mutating` members and setters change the value in its box.
An initializer's shim returns a new box, retained.

## Enums

An enum without payloads is a TypeScript `enum` of indexes. The shim
indexes `[E.a, E.b, …]` with what crossed, and gives back
`firstIndex(of:)`. A case added after the program was built reads as -1.

An enum with payloads is a union of object types:
`{ kind: "circle"; center: Point; radius: number } | …`. A payload is named
by its label, `value` when it is a lone unlabeled one, `_0`, `_1`… for
several. It crosses as a dictionary, `{"kind": case, field: payload…}`.

- The Swift file gets two functions per enum: `lucentObject_<Name>` (an
  `if case let` per case) and `lucentValue_<Name>` (a `switch` on `kind`).
  An absent optional payload is left out of the dictionary.
- The glue gets an overload of `lucentSwiftObject` per union, which
  collections' element conversions find, and a reader,
  `lucentSwiftValue_<hash>`. Both are declared first, since unions nest
  and an indirect enum holds itself.
- Cases with the same payload fields share one object type, whose `kind`
  is any of theirs.
- A case added after the program was built crosses as `kind: ""`, which
  the glue reads as a `TypeError` (`unknownSwiftCase`).

## Errors and async

`throws` adds a trailing `UnsafeMutablePointer<UnsafeMutableRawPointer?>`.
The shim's `catch` stores `error as NSError`, retained, and the glue
rethrows it as a Lucent error (`throwIfError`), as it does an `NSError **`.

An `async` member (a method, a function or an async getter) is a native
operation of the calling context (`lucent/operation.h`).

- The shim takes `ctx_`, a heap weak pointer to the operation, and
  `done_`, a C function of `(ctx, result, error)`.
- It reads its object arguments into Swift values first, since they are
  borrowed for the call only. Then it starts `Task { … }` (`Task {
@MainActor in … }` for a main-actor member) and returns the task in a
  `LucentTask`, retained.
- `done_` posts to the package's thread, which converts the result and
  settles the operation. If the operation is no longer pending, what the
  task produced is released unread.
- An async method takes an `AbortSignal` after Swift's arguments. Its
  aborting, or the context's scope ending, rejects at once; the cleanup
  calls `lucent_swift_cancel`, which cancels the task and releases it. An
  already aborted signal never starts it.
- Async members are exempt from the main-thread rule: they hop to their
  actor themselves.

## Generics

Swift generics cannot cross `@_cdecl`. A generic member gets one shim per
combination of type arguments the program uses (`specialize`). They are
the call's, from the checker's resolved signature, and the receiver's for
a generic type (`Box<Point>`, held as `LucentBox<Box<Point>>`); a static's
come from its extension, or from its call, whose declaration takes the
type's parameters it names before its own.

`sdkTypeOf` maps each type argument back to a Swift type: `number` is
`Double`, `boolean` `Bool`, `Uint8Array` `Data`, an SDK class or union
itself. Anything else is a diagnostic. The shim spells out its result's
type, so a type parameter only the result names is inferred. Generic
enums with payloads are specialized the same way.

## Async sequences

A result or property typed `AsyncSequence<T>` (`AsyncStream`,
`some AsyncSequence<T, F>`, or a module type conforming to it) is boxed as
a `LucentSequence`, erased to its elements as objects. `collect(f, signal)`
runs `lucent_swift_collect`, a task that hands each element to the glue
with a `LucentResume` continuation. It waits until the glue calls
`lucent_swift_resume` after `f` ran, and calls `done` once, with the error
the sequence ended with or none (`platform/ios_sequence.h`).

## The Swift proxy

A Lucent class that implements a Swift-only protocol gets a generated
Swift class conforming to it (`emit/swift-proxy.ts`), roughly:

```swift
final class LucentProxy_4b1e…: NSObject, Shapes.Store {
  typealias Item = String
  let ctx_: UnsafeMutableRawPointer          // the Lucent object
  let release_: @convention(c) (UnsafeMutableRawPointer) -> Void
  let r0_: @convention(c) (UnsafeMutableRawPointer, UnsafeMutableRawPointer) -> Void
  deinit { release_(ctx_) }
  func add(_ a0: String) { r0_(ctx_, lucentRetained(a0 as NSString)) }
}
```

- The class is `@MainActor` when one of its protocols is. A `@_cdecl`
  function, `lucent_swift_proxy_<hash>`, makes one from the Lucent
  object's handle and a C function pointer per requirement.
- `swiftObjectOf` gives one per Lucent object while it is in use, in a
  table of its own (`cachedObject<1>`): the same object may have an
  Objective-C delegate too. `deinit` releases the Lucent object on its
  package's thread.
- Objects are passed and returned retained, both ways.
- A method requirement runs while Swift waits when its plan says `sync`
  (a result, a throwing or main-actor requirement); a `void` one is
  queued. A Lucent method may take fewer parameters than offered.
- A property requirement is a computed property. Its getter reads the
  Lucent field or accessor, and its setter writes it, while Swift waits. A
  settable requirement needs a field that is not `readonly`, or a setter.
- A throwing requirement's C function takes an error out-parameter. What
  the Lucent method throws comes back as an `NSError` of domain `Lucent`,
  its name and code kept (`setError`), so crossing back gives the same
  Lucent error. A requirement that does not throw reports it as uncaught.
- An async requirement awaits `withCheckedContinuation` (or its throwing
  form) and hands the continuation to the glue in a `LucentContinuation`.
  The Lucent method runs on its package's thread, and when its promise
  settles the glue calls `lucent_swift_resume_<hash>_<i>` with the result
  or the error. Swift never waits for the call itself.
- A `mutating` requirement is implemented as it is: the proxy is a class.

## Associated types and Self

A protocol's associated types are type parameters of its declaration, the
primary ones first (`abstract class Store<Item = unknown>`). The class's
`implements Store<string>` clause fixes them, which becomes
`typealias Item = String` in the proxy; a clause that leaves one out is an
error.

`Self` in a requirement is the implementing class. A parameter is declared
`this` and a result the protocol, and the Lucent method must be declared to
return its own class. The proxy passes `Self` as the Lucent object it
holds.

A value of such a protocol crosses only as an argument that names every
associated type (`some Store<String>`), which Swift opens from a variable
holding `any Store<String>`. That needs the runtime's parameterized
protocol types, so the shim is `@available(iOS 16.0, *)`.

A member of such a protocol is called on a value whose type names its
associated types (`s: Store<string>`)
([0114](../decisions/0114-a-protocols-member-is-called-on-its-value-opened.md)).
The shim opens the value from a variable (`let o_ = … as! any Store`) into
a function of its own, `func opened_<S: Store>(_ s: S)`, which casts each
argument naming an associated type to it (`as! S.Item`) and the result
from it to the type the receiver's arguments fix (`as! String`). `Self`
is `S`: an argument is cast to it, and a result comes back boxed as its
type (`lucentBoxed`). A `mutating` member or a setter, of any protocol,
is called on a copy (`var s = s`), which goes back into the `LucentBox`
the value came in. A protocol's value is read through `lucentUnboxed`,
so a struct that conforms crosses in its box. Refused: static members,
and closures taking or giving an associated type, whose type is not cast.

An async or throwing property requirement is the Lucent class's getter,
which returns a promise for an async one: the proxy declares
`get async throws` and calls it as a method requirement. Refused:
initializer and static requirements (Swift would call them without an
object), and generic Lucent classes. For an initializer requirement, write the conforming type
in Swift of the package's own.

## Build

`LucentShims.swift` is written only when a program has shims, proxies or
sequences. It imports Foundation and the modules its types name, but not
`LucentNative`, whose Swift compiles into the same pod. The podspec then
sets `s.swift_version = "5.9"` and marks the C++ headers private, so the
module CocoaPods makes for Swift leaves them out (`podspec` in
`native-build-files.ts`). Each shim carries `@available` from what it
calls, when above the deployment target.
