# Swift shims: calling Swift-only iOS APIs

Status: **accepted** (2026-09-24), being implemented in Part 2 of the full
SDK plan; progress in [full-sdk-plan-status.md](../full-sdk-plan-status.md).

Goal: Lucent code calls Swift-only APIs (CryptoKit, StoreKit 2, the Swift
overlays of Foundation and UIKit) the way it calls Objective-C ones:

```ts
import { SHA256 } from "lucent:ios/CryptoKit";

export function digest(bytes: Uint8Array): Uint8Array {
  return SHA256.hash(bytes).bytes;
}
```

## What the schema says

The symbol graph already tells Swift-only declarations apart: their USRs
start with `s:`. Bindgen reads Swift structs, classes, enums and protocols,
and Swift members of any type, into the same schema as Objective-C ones,
marked `abi: "swift"`, with what a shim needs to call them:

- the Swift name of a member (`distance(to:)`, `init(x:y:)`), from which the
  call is written (`value.distance(to: a0)`);
- whether it is `static`, `mutating`, `async` or `throws`;
- a type's qualified Swift name (`AES.GCM.SealedBox`), and a payload enum's
  cases with their labels and types.

Parameters typed `some P` for a standard protocol take the one Lucent type
that conforms: `some DataProtocol` is a `Uint8Array` (passed as `Data`),
`some Collection<String>` a `string[]`, `some StringProtocol` a `string`. A
rule per standard protocol, not per API.

A type also has the members its module's own protocol extensions give it
(CryptoKit's `SHA256.hash(data:)`, from `HashFunction`; AVFoundation's
`AVAsset.load(_:)`), their associated types (`Self.Digest`) resolved to
the typealiases it declares; the standard library's extensions (Sequence,
Equatable…) are left out. A generic type's statics are bound when their
extension fixes its type parameters (`AVPartialAsyncProperty<Root>.duration`
where `Root: AVAsset`). Default arguments at the end are optional (a shim
per number of arguments), and those Lucent has no value for (`isolation:
isolated (any Actor)? = #isolation`) are never given. A method named like
a property (`frame(in:)` and `frame`) is left out: the property stays.

Types that conform to `ContiguousBytes` (a digest, a key) stay objects, and
get a `bytes: Uint8Array` property that copies their bytes out: a key must
remain a key to be used again, and its bytes are one property away.

## How a call crosses

Every used Swift member gets one `@_cdecl("lucent_swift_<hash>")` function in
`.lucent/native/cpp/generated/ios/LucentShims.swift` (the hash is of the
module, owner, member and role, so a member keeps its symbol). The
Objective-C++ glue that calls it declares it (`extern "C"`) and calls it
like any C function; Swift-only modules have no header to import.

Values cross as the Objective-C values Lucent already converts, so one set of
conversions serves Objective-C and Swift:

- scalars as C scalars; `Bool` as `bool`;
- `String`, `Data`, `Date`, arrays and dictionaries as the Foundation classes
  they bridge to (`NSString`, `NSData`, …), and bridged value types (`URL`,
  `UUID`) as theirs (`NSURL`, `NSUUID`);
- Swift class instances as object pointers: with Objective-C interop, a
  Swift object is an Objective-C object, so a `NativeRef` retains and
  releases it like any other;
- Swift structs and enums with payloads that don't bridge as boxes: a
  generic `final class LucentBox<Value>: NSObject` holding the value. Lucent
  holds the box like any object (boxed references, as decided), and member
  shims read and write through it: `mutating` members and setters change
  the value in its box;
- enums without payloads as integers, the index of the case;
- C structs (`CMTime`, `CGPoint`) as their bytes (`NSData`), loaded back
  with `loadUnaligned` in Swift and copied in the glue;
- objects cross as `void *`: those returned to Lucent retained
  (`Unmanaged.passRetained`, `__bridge_transfer` in the glue), arguments
  borrowed (`__bridge`, `takeUnretainedValue`).

This departs from the plan's "String as a UTF-16 buffer": bridging through
`NSString` reuses conversions the Objective-C glue already has, tested, and
keeps one path.

`throws` crosses as a trailing error pointer (`error as NSError`,
retained), which the glue turns into a Lucent error as it does an
`NSError **`. An `async` call is a native operation of the calling
context (`lucent/operation.h`): its shim (methods, functions and async
getters) takes a context pointer (a weak reference to the operation) and a
C callback; it reads its object arguments into Swift values first
(arguments are borrowed for the call only), runs `Task { … }`
(`@MainActor` members with `Task { @MainActor in … }`), returns the task
retained, and calls back with the result or the error. The callback posts
to the Lucent thread, which converts the result and settles the
operation, unless it is no longer pending: then what the task produced is
released. Async methods take an `AbortSignal` after Swift's arguments;
its aborting, or the context's scope being disposed, rejects the promise
at once, and the operation's cleanup cancels the task
(`lucent_swift_cancel`, which also releases it; a no-op once the task is
done). An already aborted signal never starts it. Synchronous `@MainActor` members get `@MainActor`
shims, which the main-thread rule already makes the glue call on the main
thread; async ones can be awaited from any thread.

## Generics

Swift generics cannot cross `@_cdecl`. A generic member gets one shim per
combination of type arguments the program uses (`identity<Double>`,
`identity<String>`): the call's, from the checker's resolved signature,
and the receiver's for members of generic types (`Box<Point>`, whose
values are `LucentBox<Box<Point>>`). A type argument maps back to the
Swift type it stands for (`number` is `Double`, an SDK class or union is
itself with its own arguments), and the shim spells out its result's
type, so a type parameter only the result has is inferred. Generic enums
with payloads are generic unions, specialized the same way. Unused
generic members cost nothing, as unused members do.

## Enums with payloads

In Lucent an enum with payloads is a discriminated union of object types
(`{ kind: "circle"; center: Point; radius: number } | { kind: "square";
side: number }`): the payload by label, `value` for a lone unlabeled one,
`_0`, `_1`… for several. Its members are left out (a union has none). It
crosses as a dictionary, `{"kind": case, field: payload…}`: the Swift file
gets two functions per enum (`if case let` to the dictionary, a `switch`
on `kind` back), and the glue two per union type (an overload of
`lucentSwiftObject`, which collections' element conversions find, and a
reader), with each payload converted as any value of its type. A case
added after the program was built reads as a TypeError.

## Protocols

A protocol value (`any Drawable`) crosses as an object: Swift objects as
themselves, other values in Swift's own box (`as AnyObject`), read back
with `as! any Drawable`; its members are called on the existential.

A Lucent class that implements a Swift-only protocol gets a generated
`NSObject` subclass conforming to it, which holds the Lucent object
(released on the Lucent thread when it goes) and calls each requirement
through a C function pointer the glue gives it: objects passed and
returned retained, the call on the Lucent thread as for Objective-C
protocols (queued when nothing waits for it). One per Lucent object while
it is in use, in its own table: the same object may have an Objective-C
delegate too.

- A property requirement is a computed property: its getter reads the
  Lucent field or accessor, its setter (when the requirement has one)
  writes it, while Swift waits. A settable requirement needs a field that
  is not `readonly`, or a setter.
- A throwing requirement's C function takes an error out-parameter: what
  the Lucent method throws comes back as an `NSError` (domain `Lucent`,
  its name and code kept, so it is the same Lucent error again if it
  crosses back), which the proxy throws. A requirement that does not
  throw reports what the Lucent method throws as uncaught.
- An async requirement awaits a checked continuation, which the proxy
  hands to the glue retained: the Lucent method runs on the Lucent thread
  and, when its promise settles, the glue calls a generated `@_cdecl`
  function that resumes the continuation with the result or, for a
  throwing one, the error. Swift never waits for the call itself.
- A `mutating` requirement is implemented as it is: the proxy is a class.
- A protocol's associated types are type parameters in its declaration
  (`abstract class Store<Item = unknown>`; `Store<Item>`'s primary ones
  first), fixed by the class's `implements Store<string>` clause, which
  becomes `typealias Item = String` in the proxy. `Self` in a requirement
  is the proxy class: a parameter is declared `this`, a result the
  protocol, and the Lucent method must be declared to return its own
  class. Values of such protocols cross only as arguments that name every
  associated type (`some Store<String>`, which Swift opens from a
  variable holding `any Store<String>`); that needs the runtime's
  parameterized protocol types, so the shim is `@available(iOS 16.0, *)`.
- Initializer and static requirements are refused: Swift would call them
  without an object. Async or throwing property requirements are refused.

## Build

When a program has shims, the native package's podspec gets
`s.swift_version` and the generated `.swift` file; programs without them
build as before. The example apps build it both with `use_frameworks!` and
as static libraries.
