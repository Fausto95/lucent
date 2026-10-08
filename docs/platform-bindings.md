# Platform bindings — what is implemented

The implemented part of [the design](design/m2-platform-bindings.md): platform
modules, binding schemas extracted on demand from the installed SDKs,
Objective-C++ and JNI glue, and `main()`. This page describes the current
behavior; the design document describes where it is going.

## Platform code

Platform code is written in one module, branching on `PLATFORM` from
`lucent:platform`; that is the standard form. Splitting a module into one
file per platform is the opt-in alternative (below).

```ts
import { PLATFORM } from "lucent:platform";
import { UIDevice } from "lucent:ios/UIKit";
import { Build } from "lucent:android/android.os";
import { main } from "lucent:thread";

export async function model(): Promise<string> {
  if (PLATFORM === "ios") return main(() => UIDevice.current.model);
  else return Build.MODEL ?? "unknown";
}
```

- The tests are `PLATFORM === "ios"` and `!==` (either side, either
  platform), in `if`/`else` and in `? :`, alone or leading `&&`s
  (`PLATFORM === "ios" && ready`: the then-branch is iOS code, the
  else-branch runs on both platforms). `switch (PLATFORM)` runs each
  platform's case and what it falls through to; a clause both platforms reach
  is shared code. A guard clause, `if (PLATFORM === "ios") return …` (a
  plain test, no `else`, a branch ending in return, throw, break or
  continue), makes the rest of its block the other platform's code, as
  TypeScript narrows it. Each target compiles what it can run only; the host target
  throws there ("this code runs only on iOS and Android"). `PLATFORM` as a
  value is the target's name.
- A top-level declaration that uses a platform's SDK outside a branch,
  directly or through another such declaration, belongs to that platform:
  delegate classes, SDK-typed state, helpers taking SDK types. It compiles on
  that target only. A declaration using both platforms outside branches is an
  error; exports run on both platforms, so they branch inside (their
  platform code outside a branch is reported where it is used).
- A platform's code (its imports and declarations) may only be used inside
  its branch or its declarations, and `lucent:thread` in either platform's
  code (LUCENT3004 otherwise).
- Every target type-checks both branches. Where the other platform's SDK is
  not installed, its modules are untyped there and TypeScript's errors in its
  code are ignored (that code is never emitted on that target); values that
  flow out of such a branch need a type annotation. The same holds for
  Android while the app's dependencies are not resolved yet, during
  `expo prebuild`, which runs no Gradle: its imports that are not in the
  SDK are untyped in the iOS build, and the Gradle build's `lucentBuild`
  task, which resolves them, builds and checks Android (an import still
  missing is LUCENT3004 there). An app with no Android project yet (an Expo
  app before `expo prebuild`) has nothing to resolve them with: when it
  imports modules neither android.jar nor its Lucent packages' libraries
  declare, `lucent check` and `lucent build` (host builds included) name
  them in a warning, leave Android untyped as above, and skip Android until
  `android/` exists. A build that leaves Android out (`--platforms ios`, or
  `host`) resolves nothing either, so before a Gradle build has resolved the
  app's classpath it does the same, its warning naming the Android build
  (`lucent build --platforms android`, or the app's Gradle build) that
  resolves them. An app whose Android imports are all in android.jar
  builds and checks Android as usual.
- A module that branches is built per target, like split modules, and is
  Objective-C++ (`.mm`) on iOS.

The ports in `scripts/example-app/src/sdk` (expo-application, -clipboard,
-device, -local-authentication, -location, netinfo) and the example packages
`examples/lucent-haptics` and `examples/lucent-secure-store` are written this
way: each export branches, and each platform's helpers, delegate classes and
state sit in sections of their own.

### Split into platform files (opt-in)

When a module's platform halves share nothing, it can be split: a shared
declaration file and one implementation per platform.

```
haptics.lucent.ts          export declare function impactAsync(style?: ImpactStyle): Promise<void>;
haptics.ios.lucent.ts      the iOS implementation (imports lucent:ios/…)
haptics.android.lucent.ts  the Android implementation (imports lucent:android/…)
```

- The shared file may contain only `export declare function`s, types and
  imports (LUCENT3005 otherwise). Put shared code and enums in another
  module that all three import.
- Each implementation must export exactly the declared values, with types
  assignable to the declarations (LUCENT3005). JavaScript imports the shared
  file, so it sees one API; the proxy and the JSI bindings are the same on
  both platforms.
- Each platform is checked in its own program: in platform files,
  `lucent:ios/*` and `lucent:ios` resolve only in `.ios.lucent.ts` files,
  `lucent:android/*` and `lucent:android` only in `.android.lucent.ts` files,
  and `lucent:thread` in both (LUCENT3004 otherwise, and for SDK modules
  without a schema).
- Other modules import a platform module as usual (`./haptics.lucent`); calls
  go to the platform's implementation.

### Output

Projects without platform code keep the single layout,
`.lucent/native/cpp/generated/*`. With platform code, each target gets a
complete set: `generated/ios/*` (modules with iOS code as `.mm`, Objective-C++
with ARC) and `generated/android/*`. The podspec compiles `generated/ios`,
CMake compiles `generated/android`, and the podspec links the frameworks the
iOS code imports.

`lucent build --platforms host` writes `generated/host/*`, where platform
branches throw "this code runs only on iOS and Android" and split modules'
exports throw (or reject) "`<module>.<name>` is not available on this
platform". `scripts/app-check.ts` uses it to run the rest of an app in the
Hermes host.

## Where bindings come from

There is no list of frameworks or packages. Bindings come from the native
artifacts the app's build resolved (bindgen's `nativeArtifacts`):

- **iOS**: the simulator SDK (`sdk:iphonesimulator27.0`), read for the app
  target's deployment target (`IPHONEOS_DEPLOYMENT_TARGET` in the app's
  Xcode project, else iOS 15.1), and each module on
  the search paths the app target's Pods xcconfig gives: a pod's modules are
  one artifact, `pod:Name@version` at the version Podfile.lock installed,
  with the pods it depends on there; other module maps, frameworks and Swift
  modules are `clang-module:M`, `framework:M`, `swift-module:M`. Declarations
  are read with the xcconfig's search paths, module maps and preprocessor
  definitions (`GCC_PREPROCESSOR_DEFINITIONS`, such as `COCOAPODS=1`). A
  module's pod is the directory of Pods/ that Podfile.lock names in its
  path, so a pod may name its module otherwise (`react-native-netinfo`,
  module `react_native_netinfo`).
- **iOS Swift packages**: the packages the app's Xcode project references
  (`ios/<App>.xcodeproj`, its `packageReferences`), at the versions
  Package.resolved pins (the workspace's, else the project's), are built
  for Lucent to read: each is cloned at its pinned revision into the cache
  (`spm/`), with the app's Package.resolved pinning its dependencies, and
  `xcodebuild` builds its library products (its manifest's, read with
  `swift package dump-package`) for the simulator at the app's deployment
  target. Their Swift modules (or frameworks, for dynamic products) are
  one artifact, `spm:identity@version`; a dependency's modules are its own
  package's, at the version the app pins. A build runs once per revision,
  target and Xcode version; one that fails is named where a module it
  would have given is missing. LucentNative links a package's products
  where the code imports its modules (`spm_dependency`, at the exact
  version the app resolved), so the app adds the package to its project
  without adding the product to its app target: linked by both, a static
  package's symbols would be duplicated, as React Native's SPM helper
  warns.
- **iOS with `use_frameworks!`**: pods are frameworks Xcode builds later, in
  the build products directory the xcconfig's framework search paths name.
  Before that build, each is what CocoaPods wrote for it: the module map and
  umbrella header in `Pods/Target Support Files/<pod>/`, and the public
  headers the umbrella imports, found by name in the pod's sources (its
  `PODS_TARGET_SRCROOT`, the nearest file of that name, not under
  `node_modules`). They are laid out as the framework Xcode will build, in
  the cache under a hash of their contents, and read as that framework;
  the generated code imports `<Module/umbrella.h>` and the native package
  depends on the pod.
- **Android**: the SDK platform (`android-sdk:35`: android.jar,
  `api-versions.xml`, `annotations.zip`), then each jar and AAR of the app's
  resolved compile classpath (its debug variant's; with product flavors the
  first debug variant by name, so a library only another flavor depends on
  isn't bindable; its release variant's when it has no debug variant), by
  its Maven coordinates from Gradle's cache
  (`maven:group:name:version`), else `jar:`/`aar:` and its file name, and
  the jars and AARs the app's Lucent packages ship (`android.libraries`,
  which the classpath does not list: the Lucent library links them). Which
  packages each has comes from its zip directory alone, so indexing a
  classpath of hundreds of AARs reads no class.

Each artifact is identified by that name and a hash of its declaration
inputs' contents: headers and module maps, a Swift module, or a jar's
classes (by name and CRC, so a jar written again with other timestamps
keeps it), with the SDK's version and build standing for the iOS SDK. Paths
are never part of it, and what a file's contents give is remembered by its
size, times and inode so that unchanged files are not read again.

The first time a program imports `lucent:ios/X` or `lucent:android/p.q`,
`@lucent-lang/bindgen` extracts that module from the artifact declaring it
and caches its schema per machine:

```
~/.cache/lucent/sdk/android/android-<N>-<hash>/<package>/<inputs>.json   (the SDK platform)
~/.cache/lucent/sdk/ios/iphonesimulator<version>-<build>-<hash>/<Module>/<inputs>.json   (Xcode's SDK)
```

The directory's hash covers bindgen's own code and schema format, the SDK
and, on iOS, the target triple and preprocessor definitions. The entry
records what its extraction read: each module or package whose declarations
it looked up (its own, and those of the types its signatures and supertypes
name), with the identities of the artifacts declaring them then. An entry is
used while those still resolve the same way; so adding a dependency, moving
the checkout or the Gradle cache, or installing the same pods again extracts
nothing, while a change to a library whose class a schema uses, or a newly
linked library that declares a type it could not name before, extracts that
schema again and only that one. Entries of other resolutions (another
app's classpath) sit beside each other under the hash of their inputs.
`$LUCENT_CACHE_DIR` moves the cache (default: `$XDG_CACHE_HOME/lucent`, else
`~/.cache/lucent`); `$ANDROID_HOME` or `$ANDROID_SDK_ROOT` (or
`$LUCENT_ANDROID_JARS`) and `$LUCENT_ANDROID_PLATFORM` choose the Android SDK;
`$LUCENT_XCRUN` (or `xcode-select`) chooses Xcode.

Each schema records the version of the schema format it was written in
(`format`, bindgen's `SCHEMA_FORMAT`). The cache key covers it, and a cached
schema of another format is a cache miss: it is extracted again, never an
error. A schema from anywhere else goes through `loadSchema`, which fails
with the module's name when the format is missing or not the current one.

- **Android**: the jar is read once per process (a few hundred ms for
  android.jar), and every package it has can be imported.
- **iOS**: a module costs its symbol graph (UIKit: about 40 s, once per Xcode)
  plus clang for its enum values. Frameworks the program only meets in
  signatures (UIKit's methods take Foundation types) get **names only**: their
  types as opaque nominal classes, from their symbol graphs; importing such a
  framework gives it full declarations. Which module declares a type comes
  from a scan of the headers: the SDK's once per SDK, each other artifact's
  once per contents.
- Extractions take a lock per module, so a build and a prefetch never do the
  same work twice. The lock names its process: a build that finds the lock
  of a process that died takes it over at once. Entries are published whole
  (a write and a rename); one that does not parse is a miss, extracted
  again, and a failed extraction leaves no entry. `lucent build` deals the
  modules the built platforms import, round robin, to one background
  extraction per spare core (those already cached return at once), then
  waits for them: a process per module, each loading the compiler, ran a
  4-core CI runner out of memory.
- `lucent sdk prefetch [--ios A,B] [--android p.q] [--all]` extracts ahead of
  time (default: what the project imports; `--ios` or `--android` alone:
  every module of that SDK).
- Without an SDK: a clear LUCENT3004 names the fix; `lucent build` builds the
  platforms whose SDK is installed and says which it skipped. Where a
  platform's SDK is missing, its `lucent:<platform>/*` modules are untyped,
  so shared code still type-checks.

## Binding schemas

A module's schema describes classes (native name, superclass, constructors, methods, properties,
thread rule, availability) and enums in a small type grammar: `int`, `long`,
`CGFloat`, `string`, `string?`, `long[]`, `Class<T>`, `android.os.Vibrator`,
`UIDevice`. The compiler turns each into a `.d.ts` served from a virtual
directory:

- classes are nominal (a private brand) and have a private constructor unless
  the SDK declares initializers;
- C functions Swift imports as members of CoreFoundation-style handles,
  as the module's API notes or its headers' `swift_name` attributes say
  (`CGImageGetWidth` → `cgImage.width`, `CGImageCreateWithImageInRect` →
  `cgImage.cropping(rect)`): called as the C functions they are, the
  object where the name puts `self`, a Create/Copy function's result
  owned;
- Swift names on iOS (`UIDevice.current`, `init(style:)` → `constructor(style)`),
  nested types joined with `_` (`UIImpactFeedbackGenerator_FeedbackStyle`);
  Swift initializers TypeScript cannot tell apart, their parameters' types
  the same (`init(service: String)`, `init(accessGroup: String)`), are
  static factories named after their labels (`Keychain.withService(…)`,
  `Keychain.withAccessGroup(…)`; after their types where the labels are
  the same, `withInt`), never a `constructor` that would bind whichever
  is declared first, and `new` with their arguments says so; one whose
  arguments have no labels stays the `constructor`, as Swift calls it
  with bare arguments (`new Locale_LanguageCode("en")`, while
  `init(stringLiteral:)` is `withStringLiteral`); methods
  that collide get their labels appended (`resize(height:)` →
  `resizeHeight`). Objective-C initializers are not separated yet. An
  Objective-C class method Swift imports as an initializer
  (`+widgetWithLabel:` as `init(label:)`) is a `constructor` too, sent to
  the class rather than to a new instance;
- Java names on Android, plus Kotlin-style getter properties
  (`VibratorManager.defaultVibrator`); Kotlin classes as Kotlin declares
  them (see below);
- `T?` → `T | null`; unannotated Java references are nullable
  (`Build.MODEL: string | null`);
- an option set (`NS_OPTIONS`, which Swift imports as an `OptionSet`) is
  its enum or `0`, the empty set no case names: `view.autoresizingMask = 0`;
  its cases combine with `|`;
- `Class<T>` parameters take the class itself:
  `context.getSystemService(Vibrator)` is `Vibrator | null`;
- inheritance as TypeScript can type it: every Java class extends
  `java.lang.Object`, and abstract classes keep their constructors
  (protected ones as protected) so Lucent classes extend them. A class
  declares again what TypeScript would hide or refuse to merge: the
  overloads it inherits beside its own, and a property its superclass and
  an interface give two ways (`ViewGroup.layoutDirection`, as `View`
  types it). Each is tagged `@lucentInherited` with the class declaring
  it, which is the one called. A member TypeScript cannot relate to what
  it overrides (an `Object` result narrowed to an interface) is left out,
  and coverage lists it with the reason.
- `x instanceof Cls` tests a platform object's class: `isKindOfClass:` on
  iOS (false for nil), JNI's `IsInstanceOf` on Android, and narrows `x`
  to `Cls`. A Swift-only type has no Objective-C class to test, so
  `instanceof` on one is refused;
- a Java interface's default method (a Kotlin interface's function with a
  body) is optional, so a Lucent class implementing the interface may leave
  it out; callers assert it present:
  `manager.getCredential!(context, request)`.

Names are for TypeScript; each declaration also records its native
identity, its `symbol`, which renaming never changes: `objc:` or `c:`
followed by the clang USR, `swift:` and the Swift USR (both from the symbol
graph), or `jvm:` and the JVM class name, with `#` and the member's name
and descriptor for members (`jvm:android/os/Vibrator#vibrate(J)V`; a
Kotlin-style property is its getter). An overload renamed for TypeScript
(`setValue_long`) keeps the method it calls, and a member a Swift protocol
extension gives a conforming type keeps the extension's symbol.

### Kotlin libraries

Classes kotlinc wrote carry Kotlin metadata (`@kotlin.Metadata`), which
bindgen reads from the class file bytes as it indexes a classpath, with its
own decoder (`kotlin-metadata-reader.ts`, `kotlin-metadata-decode.ts`: no
JVM runs and no class is loaded), decoding each class the first time an
extraction needs it. `kotlin.ts` gives each class its Kotlin view, and
android.ts declares its members from it, each keeping the JVM method it is
(`descriptor`, `symbol`):

- parameters have their Kotlin names, and values Kotlin's nullability where
  Java's is unknown or a default: type arguments (`List<String?>`), type
  variables, array elements; enum entries, an object's `INSTANCE` and a
  companion's field are non-null. A platform type (`String!`) stays
  unknown, as in Java;
- a `suspend` function is declared as its source signature, a promise of
  what it completes with, without the `Continuation` its descriptor ends
  with (`kotlin.suspend`), taking an `AbortSignal` last;
- a parameter that declares a default is marked (`kotlin.default`), and is
  optional where the defaults end the parameter list, or takes `undefined`
  where one without a default follows (a Kotlin shim leaves
  it out);
- a type parameter's bound other than `Any?` is recorded (`kotlin.bounds`:
  `non-null` for `Any`, `other` for the rest), each `other` one's bounds as
  Kotlin types a shim writes (`kotlin.upperBounds`: `kotlin.Comparable<T>`;
  none for a use-site projection), and so is a `fun interface`
  (`kotlin.fun`);
- properties are Kotlin's (`isEnabled`, not `enabled`), read through their
  getter and, when the setter is API, written through it (`setter`);
- an extension is a static of its facade taking the receiver first
  (`ExtensionsKt.toQuery(receiver, limit)`, `kotlin.extension`); an
  extension property is its accessors;
- top-level functions and properties are statics of their file facade
  (`ExtensionsKt`) or multi-file facade (`kotlin.kind`);
- a value class records its underlying property and type; a member the JVM
  passes one unboxed (a mangled name such as `load-X6dG1pw`, or a long for
  a `HitId`) is typed with the value class and marked `kotlin.unboxed`;
- a suspend function parameter is typed as the function Kotlin declares,
  not `Function2<A, Continuation<R>, Object>` (`kotlin.suspendFunction`);
- a Kotlin function type (`(Double) -> Unit`, nullable or not) is the
  function it declares, its result `void` for `Unit`, wherever it is (a
  parameter, a result, a property), not the `Function1<Double, Unit>` the
  JVM erases it to; an extension's, a composable's and one of a type
  Lucent does not bind stay the `FunctionN` class;
- a read-only `List<E>` of typed elements is `List<E>` in the schema (a
  copy, see [Calls](#calls)); a `MutableList`, a `List<*>` and a Java
  declaration's `java.util.List` stay `java.util.List`. A type argument
  Kotlin declares as a primitive (`List<Int>`, `Flow<Boolean>`) is the
  number or boolean (`int`, `boolean`), not `java.lang.Integer`;
- sealed classes list the subclasses Lucent declares; data classes,
  objects, companions and enums say so.

What Kotlin callers do not see is not declared: internal and private
classes and members, public fields holding them (an internal companion), `$DefaultImpls` and multi-file parts, `$default`
bridges, and the statics a value class implements its members with. The
JVM methods Kotlin generates for Java callers stay, as Java sees them:
`@JvmOverloads` overloads, the no-argument constructor of a class whose
parameters all have defaults, `@JvmStatic` statics of companion members,
an enum's `values()`. A class whose metadata cannot be read (a newer
Kotlin than the reader knows) is declared as Java sees it, and `skipped`
says why: `dev.orbit.FutureKt: its Kotlin metadata was not read
(unsupported Kotlin metadata version 99.0.0; this reader reads 1.1 to
2.5)`. Metadata naming a JVM method the class file (or a superclass it
inherits it from) does not have is reported in `skipped` too, and nothing
calls it; inline functions are left out of that check (`@InlineOnly`
ones have no method callers reach).

A schema also records its `provenance`: the artifact its declarations come
from, by build-system identity (`sdk:iphonesimulator27.0`,
`pod:WidgetsPod@1.0.0` from Podfile.lock, `clang-module:M` or
`swift-module:M` on the search paths, `android-sdk:35`, Maven coordinates
from Gradle's cache, else `jar:` or `aar:` and the file name), its kind, the
target it was read for, the extractor's hash, and a hash of the artifact's
contents (none for the iOS SDK, which its version names). None of these
holds a machine path. Two artifacts can declare the same symbol (a library
and a copy of it); the artifact and the symbol together identify a
declaration.

`planMember` and `planBinding` (bindgen's `binding-plan.ts`) derive a
member's binding plan from its schema, for a role: a call, a construction,
a property's read or write, or a protocol or interface method a Lucent
class implements. A plan has the backend (`objc`, `jni`, `swift-shim`, `kotlin-shim` or
`c-abi`), one conversion per receiver, argument and result
(`copy-string`, `retain-object`, `box-swift-value`, `optional`,
`callback`…), how the member reports failure (an `NSError **` it writes,
Swift's `throws`, a pending Java exception), the facts that hold for it,
its availability and the artifacts to link. A callback conversion says
when native code runs the Lucent function: while it waits for it (a
result, a call it runs during, the main thread), or queued on the Lucent
thread. The facts include who owns a result where a general naming
convention says so: Cocoa's method families (`alloc`, `new`, `copy`,
`mutableCopy`, `create`) and CoreFoundation's Create/Copy rule transfer it
to the caller (evidence `objc-method-family`, `cf-create-rule`).

The plan applies the ABI rules of its backend to each value, knowing which
way it flows: collections read from Objective-C hold plain values, errors
do not go in, blocks go in only as arguments and are not nested three
deep, a block read from native code takes no blocks, a pointer a block or
requirement receives is written back only while the platform waits and
only to a number or an enum; JNI cannot write fields or call setters, nor pass arrays of a type
parameter's values (their Java class depends on the values), nor Kotlin
functions taking or giving functions, and a Lucent
class cannot override a class's method whose JVM name Java cannot write
(an interface's it implements through a proxy, by any name); what only a
Kotlin shim can call (a suspend function, a value class the JVM unboxes,
a suspend function argument) has the `kotlin-shim` backend, which refuses
generic members bounded by a projected type (`T : List<out R>`, whose
bound the schema does not keep) and overriding a Kotlin class's suspend
or value-class members, for now;
Swift shims pass scalars, Swift enums, objects, tuples (as arrays of
their elements' objects; not of optional values or C structs) and
closures (as Objective-C blocks, both ways: of numbers, booleans,
strings and Objective-C objects), not optionals of scalars or
Objective-C enums. A value that cannot cross is an `unsupported` conversion with
its reason; a member no use of which can work (a read-only property
written, a Swift async initializer, a member of a protocol with associated
types called, a static requirement implemented) is `refused`, with the
rule's name. A value a use may leave out is
`omissible`: a parameter a block or requirement receives (a Lucent
function that leaves it out does not take it), and a Swift argument with
a default the call does not give; its refusal counts only against the uses
that give or take it. Types other modules declare are judged by their
facts (kind, Swift shape) from a lookup; a fact the lookup does not know
refuses nothing. Plans are derived each time, never cached with the
schema.

The compiler judges every SDK use by its plan (`compiler/src/sdk/plans.ts`,
with the type facts it reads: other modules' names, and a Swift type's
declaration): a refused use is a diagnostic (LUCENT2002 for a value,
LUCENT1008 for an assignment, the member-level rule's code otherwise) with
the plan's reason, followed by the native symbol and artifact the
declaration comes from:
`ABIThing.grid: nested collections from Objective-C are not supported yet (objc:c:objc(cs)ABIThing(im)grid in clang-module:Abi)`.
The glue takes the rest from the plan too: when a block or implemented
requirement runs Lucent code, whether a call writes an `NSError **`, and
who owns a result. A generic Swift use is judged again with its type
arguments. The declarations document what the plans refuse
(`Lucent cannot use this yet: …`, or `Lucent cannot assign this yet: …`
for a property read but not written), judged with the module's own types.

Coverage: `lucent sdk coverage` reports, per module, the members Lucent can
call and those it can't, with the reasons (Swift-only members among them,
as "Swift-only"): the members the extractor skipped, and those whose plan
refuses every use, under the plan's reason. It places each member at the
furthest stage the evidence supports, each needing the one before:
_discovered_ (declared), _representable_ (its plan can work), _generated_
(the project's last build used it, from `.lucent/sdk-usage.json`; an
unreadable report counts as none, with a warning) and
_exercised_ (listed in an `--exercised` file of symbol keys that tests or
probes write). A stage without evidence is unknown (`-`, `null` in JSON),
not 0. `--members` lists every member with its stage, symbol key, native
symbol, artifact and reason. CI fails when a module's unrepresentable
share grows past `config/sdk-coverage.json`. `--all` takes every module of each
SDK there is, listing the ones its extractor cannot read rather than
failing (IOKit, and the cross-import overlays, for the simulator), and
`--summary <file>` appends a markdown summary: the members in total and
the 20 reasons that leave out the most, summed across modules. CI runs
both and shows the summary on its job (reporting only).
[ROADMAP.md](../ROADMAP.md#done) records the last measured
numbers.

## Calls

- **iOS**: message sends with the SDK's own selectors, in Objective-C++
  compiled against the real headers:
  `[[UIImpactFeedbackGenerator alloc] initWithStyle:static_cast<UIImpactFeedbackStyle>(…)]`.
  Every enum value used is checked against the SDK with a `static_assert`.
- **Android**: JNI with descriptors derived from the schema types; class and
  member IDs are looked up once per call site, local references are freed per
  call, and classes the system class loader cannot see are loaded through the
  application's.
- **Kotlin shims** (Android): what JNI cannot call as Kotlin declares it
  gets a Kotlin function in `dev.lucent.shims.LucentShims_<package>`,
  generated for the program (one per member and pattern of arguments it
  uses) and called over JNI like a static Java method. The Lucent Android
  library compiles them (the Kotlin plugin, and kotlinx-coroutines 1.7.3
  or the newer one the app has), and keeps them from the app's shrinker
  with the rest of `dev.lucent`. Its parameters are
  numbers and booleans as themselves and any other value as `Any?`, cast
  to what Kotlin infers from the call, which names its arguments
  (`receiver.search(prefix = cast(a0))`). A call that leaves out Kotlin
  defaults calls a shim that leaves them out, so Kotlin's defaults apply;
  one that gives every argument (`null` included) calls the JVM method.
  An argument that may be `undefined` where Kotlin has a default is
  refused: Lucent chooses between the default and the value when it
  compiles the call. Value classes cross boxed: a shim constructs them,
  and unboxes and boxes them for the members the JVM passes them unboxed
  to. A `suspend` call is a promise of the calling context
  (`lucent::jni::launch`, over `nativeOperation`): its shim starts the
  coroutine in a scope the shims own, from the calling thread until it
  first suspends (`Dispatchers.Unconfined`, as a direct call would run),
  and reports the value or the Throwable to a completion (a
  `BiConsumer`); what it returns (an `AutoCloseable`) cancels the
  coroutine's `Job`. The call's `AbortSignal` aborting, or its context's
  scope being disposed, rejects the promise at once and cancels the
  coroutine; a value that arrives after that is released, never
  delivered. A thrown exception rejects the promise as a Java exception
  does. The glue matches Java objects with `instanceof` (JNI's
  `IsInstanceOf`), so the cases of a sealed class and their payloads are
  read as their classes'. A generic member's shim writes its type
  parameters as `Any?` (`Any` where Kotlin bounds them so,
  `cast<Flow<Any?>>(receiver).collect(…)`): its values are Java objects
  either way, and Lucent reads them as the use's type arguments say. Where
  Kotlin bounds one otherwise (`T : Comparable<T>`), the shim is generic
  itself: it declares its class's and its member's type parameters with
  their bounds and passes them on (`fun <T : kotlin.Comparable<T>>
Board_top(…) = …top<T>(…)`), which the JVM erases. A value class property
  is assigned through a shim too (`….best = cast(value)`), and its
  accessors are named as Kotlin's (`getBest`), their JVM names
  (`getBest-JdFk__0`) kept.
- **Kotlin functions** (Android): a Lucent function passed or assigned
  where Kotlin takes a function type is a `kotlin.jvm.functions.FunctionN`
  (a NativeProxy, over JNI) whose `invoke` converts its boxed arguments and
  calls it: queued on the Lucent thread when it gives nothing, else now,
  holding the lock, and its result boxed back; made in a view's setup, it
  runs on the main thread. It takes as many of the arguments as it
  declares; a function taking or giving functions is refused. A Kotlin
  function Lucent receives is a Lucent function holding a global reference
  to it, which calls `invoke` with its arguments boxed, a Java exception
  thrown as a Lucent error. A property of a fun interface's type (any Java
  interface with one abstract method) takes a function when written, as a
  parameter of that type does: it reads back as the interface (a get and a
  set accessor of their own types).
- **Kotlin interfaces Lucent classes implement** (Android): a member the
  JVM passes value classes unboxed (`judge-8AA5ETM(I)I`) is implemented by
  the proxy as by any name; its arguments are boxed for Lucent through the
  class's `box-impl`, and its result unboxed through `unbox-impl`. A
  suspend member (`pick(List, Continuation)`) queues the Lucent method's
  call and tells Kotlin it suspended (a `SafeContinuation` over the
  intercepted continuation, as `suspendCoroutine` makes): the promise it
  returns resumes it, through the caller's dispatcher, with its value, or
  with its error as a Java exception that Lucent reads back as the error
  itself. Its AbortSignal is not given yet.
- **Kotlin suspend functions Lucent functions implement** (Android): a
  Lucent function passed where a shim's member takes a suspend function
  (`step: suspend (String) -> Unit`), or a fun interface whose function
  suspends (a Flow's `FlowCollector`), reaches the shim as a Kotlin
  function object (`kotlin.jvm.functions.FunctionN`, a NativeProxy), and
  the shim passes the lambda Kotlin takes (`{ x0 -> f(x0) }`,
  `FlowCollector { x0 -> f(x0) }`). Kotlin waits for a suspend function, so
  the Lucent function runs when Kotlin calls it, on Kotlin's thread,
  holding the Lucent lock, and its result goes back to Kotlin. What it
  throws is thrown to Kotlin (a `RuntimeException` with its message), which
  ends the Kotlin call: the promise rejects with the Lucent error itself.
  An async Lucent function is refused there (LUCENT1007): Kotlin would go
  on before its promise settled.
- **Flows** (Android): a `Flow<T>` is a Java object whose `collect` is a
  suspend member, so collecting one is a promise of the calling context
  that the collector runs within, with nothing Lucent adds for flows:
  `await ticker.count(3).collect((n) => seen.push(n))` resolves when the
  flow completes, rejects with the error a flow throws (after the values
  it emitted), and with what the collector throws. Aborting the call's
  `AbortSignal`, or its context's scope being disposed, rejects it at once
  and cancels the coroutine collecting the flow, which stops the flow
  (its `onCompletion` sees a `CancellationException`); a flow that never
  completes (a `StateFlow`) is collected until then. `FlowKt`'s generic
  top-level functions are callable the same way (`FlowKt.first(flow)`,
  `FlowKt.toList(flow)`, whose read-only list is an array). A flow is a
  `subscribe` from `lucent:core` too: its register starts
  `collect(next, signal)` with an `AbortController` of its own, calls
  `end` or `fail` when the collection settles, and returns what aborts
  it, so the subscription's signal and a throwing `onValue` cancel the
  coroutine.
- **Swift-only APIs** (iOS): a Swift member the program calls gets a
  `@_cdecl` shim in `LucentShims.swift`, which the glue calls as a C
  function ([design](design/swift-shims.md)). Swift structs are boxed
  objects, changed in place by `mutating` members and setters; enums
  without payloads are numbers (their cases' indexes); `throws` becomes a
  Lucent error. `async` members (and async getters) return promises: the
  shim runs them in a `Task` and the glue settles the promise on the
  Lucent thread. Async methods take an `AbortSignal` last: its aborting,
  or the calling context's scope being disposed, rejects the promise at
  once and cancels the task; a result that arrives after that is
  released, never delivered. `@MainActor` members follow the main-thread rule when
  synchronous; async ones hop to the main actor themselves, from any
  thread. Enums with payloads are unions discriminated by `kind`
  (`{ kind: "circle"; center: Point; radius: number } | …`; a lone
  unlabeled payload is `value`, several are `_0`, `_1`…). Generic
  members get a shim per combination of type arguments the program uses.
  Protocol values are objects, and a Lucent class implementing a Swift
  protocol conforms through a generated Swift class: method, property,
  throwing, async and mutating requirements; associated types are the
  protocol's type parameters, fixed by `implements Store<string>`, and
  `Self` is the implementing class (initializer and static requirements
  are refused).
- Pointers a method writes through (`CGFloat *`, `NSRange *`, `NSDate **`,
  `NSError **` where Swift does not throw, `CFTypeRef *`) take an `Out<T>`
  from `lucent:ios`: read `value` after the call, and set it first for a
  number or struct the method also reads.
- A protocol composed with `NSObject` (`NSObject<NSCopying> *`, Swift's
  `any NSCopying & NSObjectProtocol`) is the protocol: every Objective-C
  object conforms to NSObject. Other compositions, selectors, class
  objects and metatypes, raw and read-only pointers, buffers and memory
  zones have no Lucent value yet; the members using them are skipped,
  each with what the type is as its reason (`raw pointers
(UnsafeRawPointer) have no Lucent value: nothing says what they point
to`), which `lucent sdk coverage` counts.
- Functions passed where the SDK takes a block, or assigned to a block
  property, become blocks, and blocks the SDK passes back (a completion handler given to a Lucent function or to a
  Lucent class's protocol method) become Lucent functions that call them.
  CoreFoundation values in blocks keep their C types.
- A Lucent class may extend an Objective-C class (`class Greeting extends
UIViewController`): a generated Objective-C subclass stands for each
  instance for its whole life. `super(…)` makes it with the base
  initializer the call resolves to (the implicit constructor with the one
  taking no arguments); the class's methods named like the base's
  instance methods override them, run while the caller waits (an override
  the base's initializer calls before `super(…)` returns runs the base's);
  `super.name(…)` calls the base's implementation, and every member the
  class inherits is its native object's. An instance passes where the
  base's type, or an Objective-C protocol it implements, is taken: the
  subclass adopts the protocols. The native object holds the Lucent
  object, and Lucent references to it hold the native object, so neither
  goes while the platform or Lucent code has it (the Lucent object is
  released on the Lucent thread). A subclass of a main-thread class
  (`UIView`, `UIViewController`) is made and its methods are called on
  the main thread, where its members run. Refused, with a reason:
  extending such a class again, a field or accessor where the base has a
  property of that name, overriding a Swift member, and Swift classes (a
  Swift subclass would be needed).
- Platform objects are `lucent::NativeRef`s: a retained Objective-C object
  (released on the main thread) or a JNI global reference. `===` compares
  identity (`IsSameObject` on Android). They cannot cross to JavaScript
  (LUCENT2006).
- Native 64-bit integers (Java's `long`, Kotlin's `Long`, `int64_t`,
  `uint64_t`, `NSInteger`, `NSUInteger`, Swift's `Int`, `Int64`,
  `UInt64`) are `bigint`s, in results, arguments, struct fields, `Out`s
  (`Out<bigint>` for an `NSInteger *`), arrays and callbacks, and in
  Kotlin shims' arguments, defaults, value classes and suspend results
  ([semantics](semantics.md#platform-code)). Every native value crosses
  exactly, `NSNotFound` and `Long.MAX_VALUE` included; a bigint the
  native type cannot hold throws `RangeError` naming the parameter or
  field. Their plans convert them with the `bigint` operation. Java
  `long` constants are inlined as their exact bigint literals.
- Enums and option sets (`NS_ENUM`, `NS_OPTIONS`) and Android constant
  groups (`@IntDef`, `@LongDef`) stay numbers. A `@LongDef` group's
  `long`s, its constants included, cross as numbers exactly or throw
  `RangeError` (their plans mark them `exact`).
- A number crossing into a narrower native integer or an enum
  (`lucent::toNativeNumber`) takes WebIDL's default conversion on both
  platforms: NaN and infinities give 0, the rest truncates and wraps
  modulo 2^bits; a 64-bit target takes the `exact` rule; `float` rounds.
- Java arrays are copied either way: `byte[]` as a `Uint8Array`, arrays of
  numbers (`int[]`, `float[]`, `char[]`…) as `number[]`, `long[]` as
  `bigint[]`, `boolean[]` as
  `boolean[]`, and arrays of objects, strings and arrays element by element
  (`File[]` as `File[]`, `int[][]` as `number[][]`); a null element of an
  object array throws `TypeError` where its type says it is not nullable,
  as for any other result. Each element's local reference is freed once it
  is converted.
- Kotlin's read-only `List<E>` is a snapshot: a result, a property or a
  suspend function's value is an `E[]` copied from the list's elements
  (one `toArray()` call), and an `E[]` Lucent passes becomes a new
  `java.util.ArrayList` holding copies of its elements. Neither side sees
  what the other changes afterwards: a read-only list may be a view of
  state that changes (`val titles: List<String> get() = items`), and its
  copy keeps what it held when it was read. Numbers and booleans Kotlin
  boxes are numbers and booleans (`List<Int>` is `number[]`), and its
  `Long`s bigints (`List<Long>` is `bigint[]`, exactly), elements may be
  `null` where Kotlin's element type says so (`List<String?>` is
  `(string | null)[]`), a `null` element where it does not throws
  `TypeError`, and lists of lists are copied deep. Unlike an array, a
  list of a type parameter's values can be passed: its class does not
  depend on them. What callers may rely on the
  identity of stays the Java object, whose methods read and change it in
  place and whose `===` compares identity: a `MutableList<E>`, a `List<*>`,
  and every `java.util.List` a Java declaration names, since Java does not
  say whether it is mutable. A `Set` or `Map` is the Java object too, for
  now.
- Java exceptions become Lucent errors whose `code` is the exception class
  (`java.lang.IllegalArgumentException`) and whose message is the
  exception's. `errorOf(throwable)` from `lucent:android` makes the same
  error of a `Throwable` a callback API reports, so an adapter's
  `reject(errorOf(e))` rejects as the call would have thrown. A
  `nil`/`null` result where the schema promises an object throws
  `TypeError`.
- A `Task`, a `ListenableFuture`, a `CompletionStage` or any other Java
  object is not a promise: `await` on a value typed as an SDK class is
  refused (LUCENT1010), whatever the class. Its completion listener becomes one
  with `fromCallback` from `lucent:core`, like any callback API: call
  `task.addOnCompleteListener(…)` inside `register` and settle from the
  listener. No class is recognized by name; the extracted methods are the
  whole API.
- Java's `AutoCloseable` (so `Closeable`, `Cursor` and the rest) declares
  `[Symbol.dispose]()`: `using cursor = …` calls `close()` however the block
  is left.

## Threads

`main(f)` from `lucent:thread` runs `f` on the main thread (the main queue;
the main Looper through a `Handler`) holding the Lucent lock, and resolves
with its result; the caller never waits for it. Main-thread-only APIs
(`mainActor` in the schema, `@MainActor` in Swift) are a compile error
(LUCENT3006) outside a `main(() => …)` literal, a block the SDK runs on the
main thread, or a protocol requirement it calls there. On Android, the
SDK's thread annotations say the same: `@UiThread` and `@MainThread` classes
and methods are main-only (`android.view.View` and every member of it but
those marked `@AnyThread`), and calling a `@WorkerThread` member in a main
context warns (LUCENT3009): it blocks. The generated declarations
document the same rule from the same check: a main-thread class says
"Main thread only", and a member says so only where it differs from its
class (an async Swift member of a `@MainActor` class is "Any thread").

The schema records what those annotations and attributes prove as `facts`
on classes and members: an affinity (`main`, `worker` or `any`) with the
annotation as evidence (`@WorkerThread`, `@MainActor`), and blocking and
ownership left `unknown`, since no annotation proves them (`@WorkerThread`
says where a member runs, not that it blocks). A member without facts of
its own takes its class's; without any, every fact is unknown. The
`mainActor` and `worker` flags the checks above read are derived from the
same facts, in one place (`bindgen/src/facts.ts`), so the two cannot
disagree.

`available("ios", major, minor?)` and `available("android", api)` check the
running OS. An API newer than the oldest OS the app runs on (on iOS, its
Xcode project's deployment target, never below 15.1; Android API 24), by
the SDK's availability attributes (iOS) or API levels
(Android's `api-versions.xml`), must be used under such a check (an `if`, an early exit on the
opposite check, `?:` or `&&`), or it is LUCENT3007; on iOS, so is passing
a Swift value that needs a newer Swift runtime (a parameterized protocol
type, iOS 16). Swift shims are marked `@available` from what they call,
and the Objective-C++ glue leaves Clang's own availability warnings off:
the check is Lucent's. `appContext()` returns the Android `Application`
(`ActivityThread.currentApplication()`).

## Android Activities

`lucent:android` gives Lucent code the app's Activities through
`dev.lucent.LucentActivities` (runtime `native/android`) and
`lucent/platform/android_activity.cpp`:

- `currentActivity()`: the Activity last created, started or resumed and
  not destroyed, or null. `LucentInitializer`, a content provider the
  library manifest declares, registers the lifecycle callbacks with the
  process, before any Activity or JavaScript. Activities are held weakly;
  the reference returned is for use now, on the main thread.
- `startActivityForResult(intent, signal?)` and
  `requestPermissions(permissions, signal?)`: each request is an Operation
  under the scope the calling context's work belongs to (`ownedScope`:
  module code's ends with its JavaScript runtime; `platform/android_requests.h`),
  settled exactly once on that context by the id the Java side echoes back.
  The request runs in `LucentRequestActivity`, a translucent Activity the
  library manifest declares (no AndroidX, any host Activity), so the app's
  Activity may be recreated while it is out; recreated itself, it waits for
  the answer instead of asking again. Permission requests run one at a
  time. An aborted signal or a disposed scope cancels the promise and tells
  Java to forget the request: a late answer is dropped, and the Activity it
  started is finished when Android lets the app (a permission dialog or
  another app's screen may stay). No Activity: `ERR_NO_ACTIVITY`; no app
  for the intent: `ERR_ACTIVITY_NOT_FOUND`; the request Activity ending
  without an answer (a new process after the old one died):
  `ERR_REQUEST_ENDED`.
- `onActivityEvent(event, handler)`: `created`, `started`, `resumed`,
  `paused`, `stopped`, `destroyed` from the lifecycle callbacks, and
  `newIntent` from AndroidX activities' new-intent listeners (found by
  name). Handlers run in a turn of the subscribing context; the returned
  function unsubscribes. Lucent's request Activity is never reported.

A reload of JavaScript does not cancel requests or subscriptions made by
module code: like module state, they belong to the legacy module context,
which outlives a runtime.

## Presenting and the app's lifecycle (iOS)

`present(build, signal?)` from `lucent:ios` presents a view controller
and resolves with its outcome:

```ts
import { UIActivityViewController } from "lucent:ios/UIKit";
import { present } from "lucent:ios";

export function share(text: string, signal?: AbortSignal): Promise<boolean> {
  return present<boolean>((resolve) => {
    const sheet = new UIActivityViewController([text], null);
    sheet.completionHandler = (_type, completed) => resolve(completed);
    return sheet;
  }, signal);
}
```

- `build` runs on the main thread holding the Lucent lock, like `main()`'s
  function (main-thread APIs compile there), and must be a function
  literal. It makes the view controller and wires its delegate or
  completion handler to `resolve` and `reject`; if it settles the promise
  itself, nothing is presented.
- The view controller is presented from the scene the person is using:
  the most recently activated window scene in the foreground (active
  before inactive), from the top of its key window's presentation chain.
  None of that is cached: it is looked up in UIKit each time. With no
  scene in the foreground, or when UIKit does not present it (another
  presentation under way, a view controller already shown), the promise
  rejects with an `InvalidStateError`.
- The promise settles once. Whatever settles it dismisses the view
  controller if it is still shown, on the main thread. It rejects with an
  `AbortError` when `signal` aborts, when the person dismisses the view
  controller (swiping a sheet down; Lucent is its presentation
  controller's delegate only when it has none), when the view controller
  is released before settling, or when its scene disconnects. Lucent holds
  the view controller weakly.
- A popover without an anchor (`UIActivityViewController` on iPad) is
  anchored to the middle of the presenting view.

`onAppEvent(event, listener, signal?)` and `onSceneEvent(event, listener,
signal?)` subscribe to UIApplication's and UIScene's lifecycle
notifications, by name (`"didBecomeActive"`, `"willResignActive"`,
`"didEnterBackground"`, `"willEnterForeground"`,
`"didReceiveMemoryWarning"`, `"willTerminate"`; `"willConnect"`,
`"didDisconnect"`, `"didActivate"`, `"willDeactivate"`,
`"willEnterForeground"`, `"didEnterBackground"`). Each returns the
function that stops it; aborting `signal` stops it too. The listener runs
on the main thread during the notification, holding the Lucent lock
(main-thread APIs compile there); a scene listener gets the scene's
session's `persistentIdentifier`. What a listener throws is logged, and
UIKit and the other observers go on. Lucent observes the notifications
from the moment the app loads: it replaces no app or scene delegate, so
the app's own and other modules' keep working.

Native code (a package's Objective-C++ sources) reaches the same through
`lucent/platform/ios_ui.h`: `presentationContext()` gives the scene, key
window and top view controller for the current turn of the main thread,
and `presentOperation<T>(scope, signal, build)` presents under a scope of
its own, whose disposal cancels the presentation.

Presentations and subscriptions made from module code belong to its
JavaScript runtime's scope (`ownedScope`): a reload ends them, as it
ends module code's operations, callbacks and timers. Not yet: URLs and user activities the app opens have no event yet (React
Native's `Linking` has them), and apps that support several scenes are
covered by unit tests only.

## Verified in the spike

- `swift-symbolgraph-extract` on UIKit (iOS 27 SDK) gives clang USRs for
  Objective-C members (`c:objc(cs)UIImpactFeedbackGenerator(im)impactOccurred`,
  `(cpy)` class properties, `(py)` properties), `@MainActor` in declaration
  fragments, enum cases with their C enumerators
  (`c:@E@UIImpactFeedbackStyle@UIImpactFeedbackStyleMedium`), and
  completion-handler methods twice under one clang USR: once with the
  handler, once as Swift `async`. Extracting UIKit takes about 40 s and 29 MB,
  so extraction results need caching.
- Generated glue compiles with `-Werror` against the iOS simulator SDK and
  the NDK (`packages/compiler/test/platforms.test.ts`); derived JNI
  descriptors match `android.jar`.
- On devices (Release, iOS 27 simulator and Android 14 emulator, bare and
  Expo apps), the example apps' SDK tab passes: the `expo-haptics` port
  (`examples/lucent-haptics`), SDK values, identity across threads,
  a Java exception's code, and, in the Expo app, the original
  `expo-haptics` through the same JavaScript API.
- Threads the app did not start (the Lucent thread) see only the system
  class loader on Android: framework classes resolve, app classes
  (fbjni's `NativeRunnable` and `HybridData`, AndroidX, Play services) do
  not. The main-thread hop runs inside `ThreadScope::WithClassLoader`, and
  `findClass` falls back to the Application's class loader.

## Not yet

[ROADMAP.md](../ROADMAP.md) lists what's next, the known binding gaps
(under T28), and the limitations kept on purpose, with the reason.
