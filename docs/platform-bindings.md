# Platform bindings

How Lucent code calls the iOS and Android SDKs, and the libraries an app
links. Bindings come from the installed SDKs and the app's resolved
dependencies, read on first import. No list of frameworks, packages or
classes decides what binds.

This page is the reference for what the code does today. The language
rules are in [semantics.md](semantics.md#platform-code), the shared
interfaces in [C-BIND](design/contracts.md#c-bind-binding-schemas-and-plans),
the generated Swift in [design/swift-shims.md](design/swift-shims.md), and
views in [design/views.md](design/views.md). What is still missing is in
[limitations.md](limitations.md) and [T112](tasks.md#t112).

## Imports

| Specifier                          | What it binds                                                                                             |
| ---------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `lucent:ios/<Module>`              | A Clang or Swift module: an SDK framework, a pod, a module map, a Swift module, a Swift package's product |
| `lucent:ios/LucentNative`          | The Swift files in the app's Lucent packages' `ios.nativeSources`                                         |
| `lucent:android/<java.package>`    | A Java package of `android.jar`, of the app's compile classpath, or of a package's `android.libraries`    |
| `lucent:ext/<name>`                | A C header a package declares in `lucent.json` `extensions`, on both platforms                            |
| `lucent:ios`, `lucent:android`     | Helpers written by hand: `available`, `Out`, `nativeError`, `appContext`, `currentActivity`…              |
| `lucent:thread`, `lucent:platform` | `main(f)`, and `PLATFORM`                                                                                 |

```ts
import { UIDevice } from "lucent:ios/UIKit";
import { Build } from "lucent:android/android.os";
import { main } from "lucent:thread";
```

The helpers are in `packages/compiler/lib/sdk/` (`ios.d.ts`,
`android.d.ts`, `thread.d.ts`, `platform.d.ts`). Everything else is
generated: `compiler/src/sdk/dts.ts` writes a module's declarations from
its schema, served from a virtual directory (`program.ts`) and cached in
`<cache>/declarations/` (`sdk/declaration-cache.ts`).

## Platform code

A module branches on `PLATFORM` from `lucent:platform`; that is the
standard form. Each target compiles its own branch, and the host target
throws there ("this code runs only on iOS and Android"). The rules live in
`compiler/src/platforms.ts`:

- A test is `PLATFORM === "ios"` or `!==`, or an unannotated `const` that
  holds one, in `if`/`else`, `?:`, a leading `&&` or `switch (PLATFORM)`.
  A guard clause (`if (PLATFORM === "ios") return …`) makes the rest of
  its block the other platform's.
- A top-level declaration, or a private member of a shared class, that
  uses one platform's SDK outside a branch belongs to that platform.
  Platform code is used only there or in its branch (LUCENT3004).
- Every target type-checks both branches. Where an SDK is not installed,
  its modules are untyped and their type errors are ignored.

Split files are the opt-in form: `haptics.lucent.ts` declares what
`haptics.ios.lucent.ts` and `haptics.android.lucent.ts` implement
(LUCENT3005). A platform without an implementation gets stubs that throw
"`<module>.<name>` is not available on Android". Each target's output is
`.lucent/native/cpp/generated/<target>/`; iOS units with platform code are
Objective-C++ (`.mm`, ARC).

## Where bindings come from

A build resolves the native artifacts the app links (`nativeArtifacts` in
`bindgen/src/provider.ts`, built by `artifacts.ts`). Each has a
build-system identity and a hash of its declaration inputs' contents.
Paths never enter an identity.

| Artifact id                                       | What it is                                                                            |
| ------------------------------------------------- | ------------------------------------------------------------------------------------- |
| `sdk:iphonesimulator<version>`                    | Xcode's simulator SDK; its version and build stand for its contents                   |
| `pod:<Name>@<version>`                            | Every module a pod defines, at the version `Podfile.lock` installed                   |
| `spm:<identity>@<version>`                        | A Swift package's modules, at its `Package.resolved` pin (`@local` for a local one)   |
| `framework:M`, `clang-module:M`, `swift-module:M` | A module on the search paths that no pod or package installed                         |
| `android-sdk:<N>`                                 | `platforms/android-N`: `android.jar`, `data/api-versions.xml`, `data/annotations.zip` |
| `maven:<group>:<name>:<version>`                  | A jar or AAR from Gradle's cache                                                      |
| `jar:<file>`, `aar:<file>`                        | Any other jar or AAR, by file name                                                    |

`projectSdk` (`compiler/src/project-sdk.ts`) gathers a project's inputs:
pods, the Xcode project, the Gradle classpath file, packages' prebuilt
binaries and Swift sources, and an exported schema set. A missing SDK is
LUCENT3004 with the fix; `lucent build` builds the platforms it can and
says which it skipped.

### iOS

- **The SDK** is what `xcrun --sdk iphonesimulator` reports
  (`$LUCENT_XCRUN` picks the `xcrun`). Declarations are read for
  `arm64-apple-ios<target>-simulator`: the app target's
  `IPHONEOS_DEPLOYMENT_TARGET` in `ios/<App>.xcodeproj` (`xcode.ts`), else
  15.1.
- **Pods.** `pods.ts` reads `Pods-<App>.debug.xcconfig`: search paths,
  `-fmodule-map-file` flags and `GCC_PREPROCESSOR_DEFINITIONS`. A module
  belongs to the pod whose directory under `Pods/` holds its files, as
  `Podfile.lock` names it, so `react-native-netinfo` may define
  `react_native_netinfo`.
- **Pods built as frameworks** (`use_frameworks!`) do not exist before
  Xcode builds them. Lucent lays each out from the module map, umbrella
  and public headers CocoaPods wrote, under `memo/…/frameworks/<hash>`.
- **XCFrameworks**, a pod's or a package's `ios.vendoredFrameworks`, are
  read through their simulator slice (`vendored.ts`).
- **Swift pods** (no public Objective-C headers) have no module before a
  build. `swift-modules.ts` emits one with `swiftc -emit-module` into
  `swift-modules/<Module>-<key>`, keyed by the sources' contents, the SDK,
  the target, the defines and the keys of the Swift pods it imports. A
  module swiftc cannot make is LUCENT3004 with its last errors.
- **LucentNative**, the Swift of packages' `ios.nativeSources`, is emitted
  the same way. The native pod compiles it with the shims, which call it
  without importing it.
- **Swift packages.** `xcode.ts` reads the project's `packageReferences`
  and `Package.resolved`. `swift-packages.ts` clones each at its pinned
  revision into `spm/<identity>-<key>`, with the app's pins, and builds
  its library products with `xcodebuild` for the simulator. A local
  package is built from a copy, keyed by its files. A build that fails is
  named where a module it would have given is missing.

A schema comes from `swift-symbolgraph-extract` (public symbols) with the
xcconfig's paths, module maps and defines (`symbolGraphArgs` in `ios.ts`).
Enum values come from clang's JSON AST dump, which symbol graphs lack. A
scan of the headers says which module declares each Objective-C type
(`header-index.ts`). The Swift names of C functions (`CGImageGetWidth` as
`width`) come from API notes and `swift_name` attributes
(`c-swift-names.ts`).

A module the program meets only in signatures gets **names only**: its
types' kinds, native names and struct fields, from its symbol graph
(`namesOf`). Importing the module gives it a full schema.

### Android

- **The SDK platform.** The root is `$ANDROID_HOME`, `$ANDROID_SDK_ROOT` or
  a usual install location. The platform is `$LUCENT_ANDROID_PLATFORM`,
  else the app's `compileSdk`, else the newest. `$LUCENT_ANDROID_JARS`
  replaces it with a list of jars.
- **The app's classpath.** The `lucentClasspath` task
  (`lucent-classpath.gradle`) writes `.lucent/android-classpath.json`. It
  holds the repository jars and AARs of the debug variant's compile
  classpath (the first flavored one by name; else release), `minSdk` and
  `compileSdk`. `lucent build` runs it through
  `lucent-classpath.init.gradle` when an import is not in `android.jar`,
  once per change of the Gradle inputs.
- **Packages' `android.libraries`** bind before Gradle runs; the
  classpath's copy of one is dropped by content.

Indexing an archive reads only its zip directory: its packages, and a hash
of its classes by name and CRC (`archiveIndex` in `android.ts`). Extraction
then parses the class files it needs (`classfile.ts`, no JDK). The first
archive on the classpath wins, as in the class loader.

- Nullability comes from the class files' annotations (`android`,
  `androidx`, JetBrains, JSR-305, libcore). An unannotated reference is
  nullable.
- Thread annotations, `@RequiresPermission`, and `@IntDef`, `@LongDef`
  and `@StringDef` groups come from `annotations.zip`, the SDK's and each
  AAR's. Flag groups are left out.
- API levels come from `api-versions.xml`, and Kotlin classes from their
  metadata ([below](#kotlin-libraries)).

Before the classpath is resolved, Android is deferred, not failed
(`cli/pipeline.ts`). Without `android/` (Expo before `expo prebuild`),
modules outside `android.jar` stay untyped with a warning. A build that
leaves Android out does the same, naming the build that resolves them.

## The cache

Schemas are cached per machine, never in the project.

```
<cache>/                                $LUCENT_CACHE_DIR, else $XDG_CACHE_HOME/lucent, else ~/.cache/lucent
  sdk/ios/iphonesimulator<version>-<build>-<key>/
    headers.json                        which SDK module declares each Objective-C type
    <Module>/<entry>.json               a schema
    <Module>/<entry>.names.json         a module's type names
    <Module>/source/<entry>.json        a module written as source (SwiftUI)
  sdk/android/<android-N | jars>-<key>/<package>/<entry>.json
  memo/<extractor>/                     what files' contents give, by their stats; pods' frameworks
  swift-modules/<Module>-<key>/         emitted Swift pods and LucentNative
  spm/<identity>-<key>/                 checked-out and built Swift packages
  declarations/<hash>.d.ts              generated SDK declarations
```

**Keys.** A scope's `<key>` hashes the extractor's version (a hash of
bindgen's sources) and `SCHEMA_FORMAT`. iOS adds the target triple and
defines; Android adds the SDK platform's identity. An `<entry>` hashes its
inputs: each module or package the extraction looked up (its own, and
those its signatures and supertypes name), with the identities of the
artifacts declaring them.

**Hits.** An entry is used while its inputs resolve the same way. Moving
the checkout or the Gradle cache, or installing the same pods again,
extracts nothing. A changed library whose class a schema uses, or a new one
declaring a type it could not name before, extracts that schema again,
only it. Entries of other resolutions sit beside each other.

**Writes.** An extraction holds `<file>.lock`, naming its host and pid
(`cache.ts`); a lock whose process died, or older than ten minutes, is
taken over. Entries are written whole and renamed; one that does not parse
is a miss. `lucent build` starts a background `lucent sdk prefetch` per
spare core, dealing the imports round robin, then waits on their locks
(`backgroundPrefetch` in `cli/project.ts`). What a file's contents give is
remembered by its path, size, times and inode (`memoByStat`), never as a
key.

**Pruning.** Scope and memo directories hold an `.extractor` mark. Once a
day the first lookup removes those another extractor wrote and nobody used
for two weeks (`$LUCENT_NO_CACHE_PRUNE` turns it off). `lucent clean
--cache --stale` removes them now; `lucent clean --cache` removes
`<cache>/sdk`.

`lucent sdk prefetch [--ios A,B] [--android p.q] [--all]` extracts early.

## Schemas, locks and schema sets

A schema (`bindgen/src/schema.ts`) lists a module's classes, enums,
structs, C functions and constants in a small type grammar (`int`,
`string?`, `long[]`, `Class<T>`, `List<E>`, `Tuple<min: int, max: int>`,
`AsyncSequence<T>`, `android.os.Vibrator`). It records:

- `format`, which is `SCHEMA_FORMAT`. `loadSchema` refuses another, naming
  the module; the cache treats one as a miss.
- `provenance`: the artifact id, kind, content hash, target and extractor,
  with no machine path.
- each declaration's `symbol`, which renaming never changes: `objc:` or
  `c:` and the clang USR, `swift:` and the Swift USR, or
  `jvm:<internal/Name>#<name><descriptor>`. An artifact and a symbol
  together identify a declaration.
- `facts`, what metadata proves ([Calls and threads](#calls-and-threads)),
  and `skipped`, the members the extractor could not type, with reasons.

Schemas are written in canonical order, so the same inputs give the same
file.

**The SDK lock.** `lucent sdk lock` checks the project and writes
`lucent-sdk.lock.json`: the targets, each module's artifacts
(`id#contentHash`) and cache entry, and every SDK symbol the code uses.
`lucent build --frozen` fails when a module is read from other artifacts
or the code uses a symbol the lock lacks. `lucent sdk diff` lists what the
installed SDKs change for the locked symbols, by native identity; `--all`
adds the rest of those modules. Each build writes the same record to
`.lucent/sdk-usage.json`.

**Exported schema sets.** `lucent sdk lock --schemas` also writes
`lucent-sdk.schemas/<platform>/`. It holds each schema the check read
(`<module>.json`), each source module (`.source.json`), and the names
(`.names.json`) of the modules those name; on Android those get full
schemas. A machine without that SDK (a Linux CI typing iOS code) reads the
set, and an installed SDK wins. A set of another `SCHEMA_SET_FORMAT` is
not read.

## Binding plans

`planMember` and `planBinding` (`bindgen/src/binding-plan.ts`) derive a
member's plan from its schema for one role: `call`, `new`, `get`, `set`,
or `implement` (a requirement a Lucent class implements). Plans are never
cached. The compiler refuses a use, documents a declaration and emits glue
from the same plan, and coverage counts what it refuses.

| Backend         | Used for                                                                                         |
| --------------- | ------------------------------------------------------------------------------------------------ |
| `objc`          | Objective-C messages, from Objective-C++                                                         |
| `c-abi`         | C functions and globals, and CoreFoundation-style handles' members                               |
| `swift-shim`    | Swift-only members, through `LucentShims.swift`                                                  |
| `jni`           | Java and Kotlin members JNI can call as they are                                                 |
| `kotlin-shim`   | Suspend functions, unboxed value classes, suspend function arguments, calls leaving out defaults |
| `kotlin-source` | Compose content, written as Kotlin source                                                        |
| `swift-source`  | SwiftUI bodies, written as Swift source                                                          |

A plan has one conversion per receiver, argument and result
(`passthrough`, `number`, `bigint`, `copy-string`, `copy-array`,
`retain-object`, `box-swift-value`, `tagged-union`, `enum`, `struct`,
`optional`, `callback`, `sequence`, `out`, `error`, or `unsupported` with
its reason). It also has how failure is reported (`nserror-out`,
`swift-throws`, `java-exception`), facts, availability, the artifacts to
link, and a `refused` rule when no use can work. A value a use may leave
out (a defaulted argument, a parameter a block offers) is `omissible`: its
refusal counts only against uses that give or take it.

The compiler reads plans through `compiler/src/sdk/plans.ts` and
`requirePlan` in `emit/native.ts`. A refused value is LUCENT2002, an
assignment LUCENT1008, other rules their own code. The message names the
native symbol and artifact; for a value that cannot cross, it suggests
wrapping the member in Swift or Kotlin the app owns:

```
ABIThing.grid: nested collections from Objective-C are not supported yet (objc:c:objc(cs)ABIThing(im)grid in clang-module:Abi)
```

Declarations document the same verdict ("Lucent cannot use this yet: …",
or "Lucent cannot assign this yet: …").

## How native shapes map to TypeScript

### Values

| Native                                                                                                       | TypeScript                                    | Crossing                                 |
| ------------------------------------------------------------------------------------------------------------ | --------------------------------------------- | ---------------------------------------- |
| `BOOL`, `bool`, Java `boolean`                                                                               | `boolean`                                     | value                                    |
| `int`, `float`, `double`, `CGFloat`, `short`, `char`, `int32_t`…                                             | `number`                                      | WebIDL conversion into narrower integers |
| Java `long`, Kotlin `Long`, `NSInteger`, `NSUInteger`, `int64_t`, `uint64_t`, Swift `Int`, `Int64`, `UInt64` | `bigint`                                      | exact, or `RangeError`                   |
| `NSString`, `String`, `CharSequence`, `CFString`                                                             | `string`                                      | copied                                   |
| `NSData`, `Data`, `CFData`, Java `byte[]`                                                                    | `Uint8Array`                                  | copied                                   |
| `NSDate`, `Date`                                                                                             | `Date`                                        | copied                                   |
| `NSArray`, `[T]`, `CFArray`, Java arrays, Kotlin read-only `List<E>`                                         | `T[]`                                         | copied, element by element               |
| `NSDictionary` with string keys, `[String: T]`, `CFDictionary`                                               | `Record<string, T>`                           | copied                                   |
| `NSSet`, Swift `Set`                                                                                         | `Set<T>`                                      | copied                                   |
| Swift tuples                                                                                                 | tuples, labels as names                       | copied                                   |
| `id`, `Any`, `AnyObject`, `AnyHashable`, `CFTypeRef`                                                         | `NSObject` (results), `ObjCValue` (arguments) | retained                                 |
| A class, protocol or interface                                                                               | its declared class                            | `lucent::NativeRef`                      |
| Java `Class<T>`                                                                                              | the class itself                              | retained                                 |

Platform objects are `lucent::NativeRef`s: a retained Objective-C object,
released on the main thread, or a JNI global reference. `===` compares
identity (`IsSameObject` on Android). They never cross to JavaScript
(LUCENT2006): return the values instead.

A number passed to a narrower integer or an enum converts as WebIDL's
default does: NaN and infinities give 0, the rest truncates and wraps
(`toNativeNumber`). A method's own 64-bit parameter also takes a safe
integer number; results stay bigints
([semantics](semantics.md#platform-code)). Java `long` constants are exact
bigint literals.

Java arrays copy both ways, objects element by element; a `null` element
the type calls non-null throws `TypeError`. Kotlin's read-only `List<E>`
is a snapshot: one `toArray()` out, a new `java.util.ArrayList` in. A
`MutableList`, a `List<*>`, a Java declaration's `java.util.List`, and
every `Set` and `Map` stay Java objects, changed in place. A direct
`ByteBuffer` becomes a `NativeBuffer` without a copy through
`adoptByteBuffer` from `lucent:android`.

### Classes, interfaces and generics

Classes are nominal (a private brand) and have a protected constructor
unless the SDK declares initializers. Protocols and Java interfaces are
abstract classes, structural, so Lucent classes implement them. Objective-C
root classes extend `NSObject` from `lucent:ios`, and Java classes extend
`java.lang.Object`. Abstract Java classes keep their constructors, so
Lucent classes extend them.

TypeScript hides inherited overloads once a subclass declares one, so a
class declares again what it inherits, and a property its superclass and
an interface give two ways. Each is tagged `@lucentInherited` with the
class that declares it. A member TypeScript cannot relate to what it
overrides (an `Object` result narrowed to an interface) is skipped.

`x instanceof Cls` tests a platform object's class: `isKindOfClass:` on
iOS (false for nil), `IsInstanceOf` on Android. It narrows `x`, which is
how Lucent code matches a sealed class's cases. Swift-only and
CoreFoundation types have no class to test, so it is refused there.

Objective-C lightweight generics and Java type parameters are type
parameters defaulting to `unknown`, so raw references stay valid. On iOS a
reference gives a generic type all its arguments. A static member names
only the class type parameters it uses. Swift generic members get a shim
per combination of type arguments
([swift-shims.md](design/swift-shims.md#generics)).

### Optionals and nullability

`T?`, `_Nullable T` and `@Nullable T` are `T | null`, and so is an
unannotated Java reference (`Build.MODEL: string | null`). Kotlin's
nullability wins where Java's is unknown (type arguments, type variables,
array elements); a platform type (`String!`) stays unknown. A `nil` or
`null` result where the type promises an object throws `TypeError`. A
property Swift imports as `T!` keeps its superclass's non-null contract.

### Enums, option sets and constant groups

`NS_ENUM` is a TypeScript `enum` of its raw values, each value the glue
uses checked against the SDK with a `static_assert`. `NS_OPTIONS` is the
same, plus `0` for the empty set (`view.autoresizingMask = 0`); cases
combine with `|`. A case newer than its enum records its own `since`.

A Swift enum without payloads is an `enum` of its cases' indexes. One with
payloads is a union discriminated by `kind`:
`{ kind: "circle"; center: Point; radius: number } | …`. A lone unlabeled
payload is `value`, several are `_0`, `_1`… Members of Swift enums are
skipped.

An Android `@IntDef`, `@LongDef` or `@StringDef` group types its parameters
and results as its constants' literal types
(`typeof Toast.LENGTH_SHORT | typeof Toast.LENGTH_LONG`). A literal outside
the group warns (LUCENT3008), since Java compiles it too. A group's
`long`s stay numbers, exact or `RangeError`. An annotation type holding
only constants (Play services' `Priority`) is an `enum`.

### Structs and handles

A C struct of numbers, booleans, enums and structs (`CGRect`, `NSRange`)
is a plain object type, copied by value. An opaque CoreFoundation-style
handle (`CGImageRef`) is a class whose members are the C functions Swift
imports for it: `CGImageGetWidth` is `image.width`, with the object where
the Swift name puts `self`.

### Names

- **iOS** uses Swift's names (`UIDevice.current`, `init(style:)` as the
  constructor). Nested types join with `_`
  (`UIImpactFeedbackGenerator_FeedbackStyle`). Methods drop their labels;
  colliding overloads get them back (`resize(height:)` is `resizeHeight`),
  or the selector's words when Swift names them alike (`setDoubleForKey`).
- **Protocol requirements** keep every label, joined with `_`:
  `locationManager(_:didUpdateLocations:)` is
  `locationManager_didUpdateLocations`. Two requirements of one name are
  skipped, never renamed.
- **Initializers TypeScript cannot tell apart** become static factories:
  Objective-C ones by their labels (`FileHandle.forUpdatingAtPath(…)`),
  Swift ones by `with` and their labels (`Keychain.withService(…)`) or
  types (`withInt`). One without labels stays the constructor. A class
  method Swift imports as an initializer is a constructor sent to the
  class.
- **Android** uses Java names, plus a read-only property for each `get…`
  or boolean `is…` getter (`VibratorManager.defaultVibrator`). Renamed
  overloads (`setValue_long`) keep the JVM method they call.
- Swift types named like JavaScript globals (`Date`, `Array`, `Error`…)
  are left out.

### Kotlin libraries

Classes kotlinc wrote carry `@kotlin.Metadata`, decoded from the class
bytes on first use with no JVM (`kotlin-metadata-reader.ts`,
`kotlin-metadata-decode.ts`, `kotlin.ts`). Each member keeps the JVM
method it is.

- Parameters have Kotlin's names, and properties are Kotlin's
  (`isEnabled`), through their getter and setter.
- Extensions and top-level declarations are statics of their facade, an
  extension taking its receiver first (`ExtensionsKt.toQuery(r, limit)`).
- A parameter with a default is optional where the defaults end the list,
  or takes `undefined` where one without a default follows.
- A value class records its underlying property; members the JVM passes
  it unboxed are typed with the value class.
- A Kotlin function type (`(Double) -> Unit`) is a function, not
  `Function1`, and a suspend function parameter is typed as Kotlin
  declares it.
- What Kotlin callers do not see is left out (internal declarations,
  `$DefaultImpls`, `$default` bridges); what Kotlin generates for Java
  stays (`@JvmOverloads`, `@JvmStatic`).
- Metadata newer than the reader knows (1.1 to 2.5; 2.4 when strict)
  leaves the class as Java sees it, and `skipped` says why.

### Functions

A Lucent function passed where the SDK takes a block, or assigned to a
block property, becomes a block. A block the SDK hands over is a Lucent
function that calls it. On Android, a function passed where Java takes a
functional interface or a Kotlin function type becomes a `NativeProxy`
object; a Kotlin function Lucent receives holds a global reference.

A callback's plan says when native code runs it. It is `sync` while the
platform waits (it returns a value, runs during the call, or runs on the
main thread), else `queued` on its package's thread. A property of a fun
interface's type takes a function and reads back as the interface.

### Async

| Native                                                       | Lucent                                                                   |
| ------------------------------------------------------------ | ------------------------------------------------------------------------ |
| Completion handler last, which Swift also imports as `async` | The handler method, plus one without the handler returning a promise     |
| Swift `async` method                                         | `Promise<T>`, and an optional `signal: AbortSignal` last                 |
| Swift `async` getter                                         | A property of type `Promise<T>`                                          |
| Kotlin `suspend` function                                    | `Promise<T>`, and an optional `signal: AbortSignal` last                 |
| Kotlin `Flow<T>`                                             | A Java object; `await flow.collect((v) => …, signal)` is a suspend call  |
| Swift `AsyncSequence`, `AsyncStream`                         | `AsyncSequence<T>` from `lucent:ios`; `await seq.collect(f, signal)`     |
| `Task`, `ListenableFuture`, `CompletionStage`…               | Java objects; `await` on one is LUCENT1010; adapt it with `fromCallback` |

A completion handler's promise is settled on its package's thread: the
handler's `NSError` rejects it, its other argument resolves it. It takes
no signal. A handler with several results keeps only the block form, and
protocols declare only the block form.

For Swift `async` and Kotlin `suspend`, aborting the signal, or the
calling context's scope ending, rejects at once and cancels the task or
coroutine; a late value is released. A flow's `collect` resolves when the
flow completes and rejects with what the flow or the collector throws; it
composes with `subscribe` from `lucent:core`. `AsyncSequence.collect`
calls `f` for each element in order, the sequence waiting for each call
(`platform/ios_sequence.h`).

### Errors

| Native failure                               | Lucent error                                                            |
| -------------------------------------------- | ----------------------------------------------------------------------- |
| `NSError **` a method writes, Swift `throws` | `Error`, `code` `"<domain>:<code>"`, message the `localizedDescription` |
| A Java exception, a Kotlin `Throwable`       | `Error`, `code` the class name (`java.lang.IllegalStateException`)      |
| A completion handler's `NSError`             | the promise's rejection, as above                                       |

`nativeError(error)` gives back the `NSError` or `Throwable`, for
`instanceof` and typed reads, or `null` for an error Lucent or JavaScript
made. `errorOf(throwable)` from `lucent:android` makes the error a call
would have thrown. Objective-C methods take `Error` arguments as
`NSError`s. The glue does not catch Objective-C exceptions (`NSException`).

### Out-parameters

A pointer a method writes through (`CGFloat *`, `NSRange *`, `NSDate **`,
`CFTypeRef *`, a non-throwing `NSError **`) takes an `Out<T>` from
`lucent:ios`; an `NSInteger *` is an `Out<bigint>`.

```ts
const red = new Out<number>();
if (color.getRed(red, null, null, null)) use(red.value);
```

Read `value` after the call; set it first for a number or struct the
method also reads. A pointer a block or requirement receives
(`BOOL *stop`) is written back after the Lucent function returns, only
while the platform waits, and only to a number or an enum.

## Calls and threads

**iOS.** Calls are message sends with the SDK's own selectors, in
Objective-C++ compiled against the real headers. A result of a Cocoa
method family (`alloc`, `new`, `copy`, `mutableCopy`, `create`) or of a
Create/Copy function is the caller's (evidence `objc-method-family`,
`cf-create-rule`). A value set on a `weak` property is retained by its
owner as an associated object, so a delegate lives while it is set.

**Android.** Calls are JNI with descriptors from the schema. Class and
member IDs are looked up once per call site (`LUCENT_JNI_SITE`), each call
runs in a local frame, and a pending exception becomes a Lucent error.
Classes the system class loader cannot see load through the app's.

**The main thread.** `main(f)` from `lucent:thread` runs `f` on the main
queue or `Looper`, holding its package's actor, and resolves with its
result. The main thread never waits for module code. A main-thread-only
API is LUCENT3006 outside:

- a `main(() => …)` literal, `present`'s builder, or an `onAppEvent` or
  `onSceneEvent` listener;
- a block the SDK runs on the main thread (`@MainActor`, or not
  `@Sendable` in a main-actor member);
- a requirement the platform calls there, a component's setup, or a
  member of a class extending a main-thread iOS class.

Swift `async` members are exempt: they hop to their actor. Android
`@WorkerThread` work on the main thread warns (LUCENT3009). `mainQueue()`
and `serialQueue(label)` from `lucent:ios` give queues for APIs that take
one.

**Facts.** The schema records what annotations prove (`bindgen/src/facts.ts`):
an affinity (`main`, `worker`, `any`) with its evidence (`@MainActor`,
`@UiThread`, `@MainThread`, `@AnyThread`, `@WorkerThread`). Blocking and
ownership stay `unknown` unless a rule proves them. A member without facts
takes its class's, and the older `mainActor` and `worker` flags derive
from the same facts.

**Availability.** An API newer than the oldest OS the app runs on is
LUCENT3007 outside a check. The oldest iOS is the deployment target, never
below 15.1; the oldest Android is the classpath file's `minSdk`, else 24.
A check is `available("ios", 16)`, `available("android", 31)` or
`Build_VERSION.SDK_INT >= 31`, with literal arguments, in an `if`, `?:`,
`&&`, or an early exit on the opposite check. Passing a parameterized
Swift protocol type needs iOS 16; Swift shims carry `@available`.

`appContext()` is `ActivityThread.currentApplication()`. Java's
`AutoCloseable` declares `[Symbol.dispose]()`, so `using` closes it.

## Delegates and listeners

A Lucent class that `implements` an SDK protocol or interface goes where
the SDK takes one.

```ts
class Updates implements CLLocationManagerDelegate {
  locationManager_didUpdateLocations(m: CLLocationManager, l: CLLocation[]): void {}
}
```

**Objective-C protocols** (`emit/delegates.ts`). A generated class,
`Lucent<Name>`, adopts the protocols and forwards the requirements the
Lucent class implements; optional ones it leaves out stay unimplemented.
It holds the Lucent object, one per object while in use
(`lucent::objc::cachedObject`). A requirement that returns a value or is
main-actor runs while the platform waits, any other is queued, and a
Lucent method may take fewer parameters than offered.

**Swift-only protocols** get a generated Swift class
([swift-shims.md](design/swift-shims.md#the-swift-proxy)).

**Java interfaces** use one `java.lang.reflect.Proxy` class for every
interface (`dev/lucent/NativeProxy.java`), keyed by method name and
parameter descriptor. A default method Lucent leaves out keeps its
Java body from API 26; on 24 and 25 it returns its zero value, logged.
Arguments convert on the calling thread. A `void` method is queued; one
with a result runs while Java waits, and a primitive one that threw gives
its zero value.

A Kotlin interface's suspend member takes an `async` method: the proxy
tells Kotlin it suspended (a `SafeContinuation`, as `suspendCoroutine`
does), and the promise resumes it through the caller's dispatcher. Value
classes the JVM passes unboxed are boxed for Lucent and back.

## Subclassing

**Objective-C classes**: `class Greeting extends UIViewController` gets a
generated `LucentSub_<Name>` (`emit/objc-subclass.ts`) standing for each
instance for its whole life. `super(…)` makes it with the base
initializer the call resolves to, and the implicit constructor with the
one without arguments. Methods named like the base's override them, run
while the caller waits (before `super(…)` returns, the base's run).
`super.name(…)` calls the base's implementation, and the subclass adopts
the class's Objective-C protocols.

The native object holds the Lucent object, and each Lucent reference holds
the native object (an aliasing reference), so neither outlives the other
and no cycle forms. A subclass of a main-thread class is made and used on
the main thread.

**Java classes** (`emit/java.ts`). A generated subclass,
`dev.lucent.generated.<Name>`, is made when an instance first goes to
Java. It overrides each method the Lucent class defines, and each abstract
one, through `NativeProxy.dispatch`, and its handle is released when Java
collects it.

| Refused on iOS                                      | Refused on Android                                         |
| --------------------------------------------------- | ---------------------------------------------------------- |
| Swift classes (subclass them in Swift)              | A base without a public constructor taking no arguments    |
| Extending a Lucent class that extends an iOS class  | `super(…)` with arguments, and `super.name(…)`             |
| A field named like a base property (set it instead) | Overriding a method whose JVM name Java cannot write       |
| Overriding a base property with accessors           | Overriding a Kotlin class's suspend or value-class members |
| Overriding a Swift member                           | Interfaces (implement them)                                |
| Generic classes; protocols (implement them)         |                                                            |

## Swift shims

What only Swift can call goes through a generated `@_cdecl` function in
`LucentShims.swift`, which the glue declares `extern "C"`. That covers
Swift-only types (structs, enums, classes, protocols) and Swift members of
any type, Objective-C classes' overlays included; an Objective-C member of
the same name wins. [design/swift-shims.md](design/swift-shims.md) has the
design.

- Swift structs are boxed objects, changed in place by `mutating` members
  and setters. A `ContiguousBytes` type gets a `bytes` property that
  copies its bytes out.
- `some DataProtocol` takes a `Uint8Array`, `some StringProtocol` a
  string, `some Collection<E>` an array: one rule per standard protocol.
- Members a module's own protocol extensions give (`SHA256.hash(data:)`)
  are bound; the standard library's are not.
- Trailing default arguments are optional, a shim per count; those Lucent
  has no value for (`isolation: isolated (any Actor)? = #isolation`) are
  never given.

With shims, the podspec sets `s.swift_version = "5.9"` and keeps the C++
headers private, so Swift imports the pod without C++ interop.

## Kotlin shims

What JNI cannot call as Kotlin declares it goes through a generated Kotlin
function (`emit/kotlin.ts`). That covers suspend functions, unboxed value
classes, suspend function arguments, and calls leaving out Kotlin
defaults. Each package gets an object,
`dev.lucent.shims.LucentShims_<package>`, with a `@JvmStatic` function per
member and pattern of given arguments, called over JNI as a static method.

- Numbers and booleans pass as themselves, everything else as `Any?`,
  cast where Kotlin infers the type: `receiver.search(prefix = cast(a0))`.
- Arguments a call leaves out are left out of the Kotlin call, so
  Kotlin's defaults apply. An argument that may be `undefined` where
  Kotlin has a default is refused: the choice is made at compile time.
- A suspend call launches in the shims' scope
  (`SupervisorJob() + Dispatchers.Unconfined`) and runs on the calling
  thread until it first suspends. It reports to a `BiConsumer` of the value
  or the `Throwable`, and returns an `AutoCloseable` that cancels the job.
- Type parameters are `Any?` (or `Any`); one bounded otherwise
  (`T : Comparable<T>`) makes the shim generic, with the bound.
- A Lucent function passed as a suspend function runs when Kotlin calls
  it, on Kotlin's thread. An `async` Lucent function is refused there:
  Kotlin would go on before its promise settled.

The files go to `.lucent/native/android/src/main/java/dev/lucent/shims/`.
The library applies the Kotlin Android plugin and depends on
`kotlinx-coroutines-core` 1.7.3, or the app's newer one; its consumer rules
keep `dev.lucent.**` from the shrinker.

## Activities, scenes and presentation

`lucent:android` reaches the app's Activities through
`dev.lucent.LucentActivities` and `platform/android_activity.cpp`.
`LucentInitializer`, a content provider the library's manifest declares,
registers the lifecycle callbacks when the process starts, before any
Activity or JavaScript.

- `currentActivity()` is the Activity last created, started or resumed
  and not destroyed, or null. Activities are held weakly, so use the one
  returned now, on the main thread.
- `startActivityForResult(intent, signal?)` and
  `requestPermissions(permissions, signal?)` each make an operation under
  the scope of the calling context's work (`ownedScope`; module code's
  ends with its JavaScript runtime). `platform/android_requests.h` settles
  it once, on that context, by the id the Java side echoes back.
- The request runs in `LucentRequestActivity`, a translucent Activity the
  library's manifest declares. The app's Activity may be recreated while
  it is out, and the request Activity, recreated, waits for its answer
  instead of asking again. Permission requests run one at a time.
- An abort or a disposed scope cancels the promise and tells Java to
  forget the request, so a late answer is dropped. The errors are
  `ERR_NO_ACTIVITY`, `ERR_ACTIVITY_NOT_FOUND` and `ERR_REQUEST_ENDED` (the
  request Activity ended without an answer).
- `onActivityEvent(event, handler)` reports `created`, `started`,
  `resumed`, `paused`, `stopped` and `destroyed`, and `newIntent` from
  AndroidX activities. Lucent's request Activity is never reported.

On iOS, `onAppEvent` and `onSceneEvent` observe UIApplication's and
UIScene's notifications from the moment the app loads, without replacing
a delegate, so the app's own delegates and other modules keep working. A
package's Objective-C++ reaches presentation through `platform/ios_ui.h`:
`presentationContext()` gives the scene, key window and top view
controller for the current main-thread turn, and
`presentOperation<T>(scope, signal, build)` presents under a scope whose
disposal cancels it.

Presentations and subscriptions made from module code belong to its
JavaScript runtime's scope, so a reload ends them.

What only the app delegate or a scene delegate receives reaches
`onAppEvent` through `LucentAppDelegate`, whose class methods the
delegates call with what UIKit gave them: `openURL`, `userActivity`,
`shortcutItem`, `pushToken`, `pushTokenFailed`, `remoteNotification`,
`backgroundFetch`, `backgroundURLSession` and
`supportedInterfaceOrientations`. Each listener has its event's own
arguments and answer. Lucent's init adds the calls to a bare app's
`AppDelegate.swift` and `SceneDelegate.swift`, each line ending in a
`// lucent:forward` comment. In an Expo app, Lucent's subscriber gets
them from Expo's `AppDelegate`. [T110](tasks.md#t110) adds the events
only the Activity receives.

## Pods, Gradle and Swift packages

Bindings install nothing: they read what the app's build installed. The
native package links what the code uses (`linkModule` in
`emit/native.ts`, `native-build-files.ts`).

| The code imports                | The generated native package                                         |
| ------------------------------- | -------------------------------------------------------------------- |
| An SDK framework                | Lists it in `s.frameworks`, and imports the module's umbrella header |
| A pod's module                  | `s.dependency "<Pod>"`                                               |
| A Swift package's module        | `spm_dependency(s, …)` at the version or revision the app resolved   |
| A local Swift package           | `spm_dependency` with the package's path                             |
| A Gradle library                | Nothing: it is on the app's classpath                                |
| A package's `android.libraries` | An `api` dependency of the Lucent library                            |

A package's `lucent.json` adds its `ios.pods` (marked `# lucent.json`),
`ios.swiftPackages`, `ios.vendoredFrameworks` and `android.dependencies`.
The app adds a Swift package to its project but not its product to the
app target: linked by both, a static package's symbols would be
duplicated. A package's pod binds once installed; in Expo, `expo prebuild`
stops at one not installed yet ([T141](tasks.md#t141)). Packages' Kotlin
and Java are compiled but not typed ([T143](tasks.md#t143)).

## Android permissions

Each SDK method the code calls brings the permissions its
`@RequiresPermission` names (`value`, `anyOf` and `allOf` alike), from the
SDK's and the AARs' `annotations.zip`. A property read brings its
getter's, a write or a JSX prop its setter's. They become
`<uses-permission>` in the library's `AndroidManifest.xml`, merged into the
app's beside packages' `android.permissions`. Runtime permissions are still
asked for with `requestPermissions` from `lucent:android`.

## Typed C extensions

A package declares a C header in `lucent.json`, imported as
`lucent:ext/<name>` on both platforms, shared code included.
`compiler/src/extensions/bind.ts` reads the header with clang
(`bindgen/src/c-header.ts`) and checks the declaration against it
([C-EXT](design/contracts.md#c-ext-typed-native-extensions)).

```json
{
  "extensions": {
    "orbit": {
      "header": "native/orbit.h",
      "handles": {
        "OrbitFilter": { "create": "orbit_filter_create", "destroy": "orbit_filter_destroy" }
      },
      "functions": { "orbit_hash": { "params": { "data": { "bytes": "read", "length": "size" } } } }
    }
  }
}
```

- The header sits in a directory both `ios.nativeSources` and
  `android.nativeSources` list, and compiles as C++ with C linkage.
- A **handle** is an opaque struct with a `create` (null on failure) and a
  `destroy`. It is a class: `create` is the constructor, `methods` take it
  first, and `close()` or `[Symbol.dispose]` destroys it once.
- Numbers, booleans and handles need no declaration; 64-bit integers are
  bigints. A pointer is `bytes` (read or write, with its length), a UTF-8
  `string`, or an `error` struct the call fills in.
- `failsWhen` (`null`, `negative`, `nonzero`, `zero`, `false`) makes a
  failure throw with the error struct's message and code; `release` frees
  it. `affinity: "main"` keeps a function or handle on the main thread,
  and `blocking` warns when it is called there.
- Header functions the declaration does not name bind when they need
  nothing; the rest are listed as not bound.

Callbacks, variadic functions, C++ and cancellation are refused
([T142](tasks.md#t142)).

## Coverage

`lucent sdk coverage` reports how far each member of a module gets
(`bindgen/src/coverage.ts`):

| Stage           | Evidence                                                                    |
| --------------- | --------------------------------------------------------------------------- |
| `discovered`    | The schema declares it                                                      |
| `representable` | Its plan can work, judged with the types other modules declare              |
| `generated`     | The project's last build used it (`.lucent/sdk-usage.json`)                 |
| `exercised`     | An `--exercised` file of symbol keys, which tests or probes write, lists it |

A stage without evidence is unknown (`-`, `null` in JSON), not 0.
Representable members split into `idiomatic` (a getter as a property, a
completion handler as a promise) and `raw`; the rest are counted by
reason. Swift's Hashable, Equatable and Codable plumbing is counted apart.

- `--ios UIKit,Foundation` and `--android 'android.*'` choose modules,
  else the project's imports; `--all` takes every module of each SDK.
- `--members` lists each member with its stage, symbol key, native symbol,
  artifact and reason; `--views` adds what view classes take in JSX.
- `--check <baseline>` fails when a module's unrepresentable share grows;
  `--update <file>` writes the reports. CI checks `config/sdk-coverage.json`.
- `--summary <file>` appends the totals and the 20 reasons that leave out
  the most.

`lucent sdk show UIKit.UIDevice` prints a declaration, and
`lucent sdk search <term>` finds names.

## Shapes still refused

Each is a diagnostic with its reason, and coverage counts it.
[T112](tasks.md#t112) tracks the ones common libraries use.

| Where           | Refused                                                                                                                 |
| --------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Both platforms  | A `WeakRef` to an SDK object, or a `WeakMap` keyed by one                                                               |
| Objective-C     | Nested collections read from Objective-C; blocks, errors, out-pointers and classes as collection elements               |
| Objective-C     | Blocks except as arguments; blocks taking blocks, read from native code; three levels of blocks                         |
| Objective-C     | Selectors, class objects, metatypes, raw, read-only and buffer pointers, zones, compositions other than with `NSObject` |
| Swift shims     | Optional closures and tuples; optionals, C structs and Objective-C enums in collections; optional enums; `Set`s         |
| Swift shims     | Closures taking or giving anything but numbers, booleans, strings and Objective-C objects                               |
| Swift shims     | Subscripts, parameter packs, `inout` parameters, failable and generic initializers, operators                           |
| Swift shims     | Members of protocols with associated types; statics of generic types no extension fixes                                 |
| Swift shims     | Async initializers; async or throwing property requirements; initializer and static requirements                        |
| Swift shims     | Async sequences other than results                                                                                      |
| JNI             | Assigning Java fields; arrays of a type parameter's values; Kotlin functions taking or giving functions                 |
| JNI             | Wildcard types, `Class` other than `Class<T>`, nullable array elements                                                  |
| Implementations | A `char` argument, or a result that is not a number, boolean, string or object, in a method Java calls                  |
| Kotlin shims    | Generic members bounded by a projected type (`T : List<out R>`)                                                         |
| Promise forms   | Completion handlers with several results; completion-handler promises on Android                                        |
| Subclasses      | See [Subclassing](#subclassing)                                                                                         |
| C extensions    | Callbacks, variadic functions, C++ ([T142](tasks.md#t142))                                                              |
