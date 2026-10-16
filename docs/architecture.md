# How Lucent works

The code-level map for people changing Lucent. It says which package
does what, and how `lucent build` turns `*.lucent.ts` and `*.lucent.tsx`
sources into `.lucent/native`. It then covers how that package is linked
into an app, and how the C++ runtime is layered. Planned work is marked
and links its task.

[semantics.md](semantics.md) is the language contract.
[platform-bindings.md](platform-bindings.md) covers SDK bindings,
[design/views.md](design/views.md) the design of views,
[tracing.md](tracing.md) traces, and [testing.md](testing.md) the test
suites. A change to a part updates its section here in the same commit.

```text
 *.lucent.ts(x) of the app and its Lucent packages
      │  lucent build · lucent dev · Metro · autolink · Gradle · Expo plugin
      ▼
 cli/pipeline.ts  buildProject(): resolve, bind, check, generate
      ▼
 compiler  compile(): a TypeScript program per target ─► checks ─►
      │    analyses ─► semantic IR ─► C++ · Swift · Kotlin · Java · JS
      │    (bindgen: SDK schemas · codegen: syntax trees and printers)
      ▼
 .lucent/native ── pod install (LucentNative.podspec)
                ── Gradle (CMake into appmodules, an Android library)
                ── Metro (js/ proxies replace each *.lucent.ts module)
```

## Packages

An app installs one package, `@lucent-lang/lucent`. The others are
private workspace packages that its build bundles or copies.

| Package                 | What it holds                                                                                                                                             |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@lucent-lang/lucent`   | The CLI (`src/cli`), Metro integration (`metro/`), `autolink/`, the Expo plugin (`app.plugin.js`), `gradle/`, the editor plugin (`ts-plugin/`), templates |
| `@lucent-lang/compiler` | Program setup, checks, analyses, IR, code generation, the native package writer; `lib/` holds the `lucent:*` declarations and `core.cjs`                  |
| `@lucent-lang/bindgen`  | Reads SDKs, pods, Swift packages, Gradle libraries and C headers into cached binding schemas and plans                                                    |
| `@lucent-lang/codegen`  | A syntax tree, builders and a printer per language: `cpp` (with Objective-C++), `java`, `kotlin`, `swift`, `ts`, `xml`                                    |
| `@lucent-lang/runtime`  | The C++ runtime (`cpp/lucent`), the TurboModule and view hosts (`cpp/rn`), native templates (`native/`), the JS loader (`js/`)                            |

The compiler depends on bindgen, codegen, the runtime and `typescript`;
the CLI on the compiler and bindgen. Bindgen and codegen stand alone.

`packages/lucent/vite.config.ts` bundles the CLI and the compiler into
`dist/` (`vp pack`), and copies `compiler/lib` and
`runtime/{cpp,js,native}` (and `prebuilt/`) beside it. `runtimeDir()`
(`compiler/src/native-package.ts`) looks for that `runtime/` first, then
for the workspace's, so the same code runs bundled and from sources.

## The build pipeline

### The steps of `buildProject`

Every build goes through `buildProject` in
`packages/lucent/src/cli/pipeline.ts`, in `build` or `check` mode:
`lucent build` and `lucent check`, `lucent dev` (which Metro starts),
`autolink/index.cjs`, Gradle's `lucentBuild` task and the Expo plugin.
Most steps record a node in the [build record](#build-records). In order:

1. **Resolve**: find the app's Lucent files and the packages it depends
   on, merge their `lucent.json` needs (`resolveNative`,
   `compiler/src/package-config.ts`), and bind their C extensions.
2. **Link early**: in build mode, `writeLinkedPackage`
   (`src/cli/project.ts`) copies missing templates and writes the
   packages' pods and Gradle artifacts into the build files. So
   autolinking links the package, and `pod install` installs its pods,
   even when the check then fails.
3. **Android dependencies**: when code imports an Android module, Gradle
   writes `.lucent/android-classpath.json`, once per change of the app's
   build files or lockfile, one run at a time. Inside a Gradle build or
   during prebuild no Gradle starts: Android is cached or deferred.
4. **Targets**: the platforms whose SDK this machine has. When none can
   be built, a check, or a build that deferred Android, compiles `host`.
5. **Up to date?**: the build stops when the last passing check still
   holds (see [Caching](#caching)).
6. **SDK bindings** (`extract`): load or extract the schema of each
   imported `lucent:ios/*` and `lucent:android/*` module.
7. **Check**: run `compile()`. A build writes failing modules'
   diagnostics to `.lucent/problems.json` for Metro, then
   `.lucent/sdk-usage.json` once it passes.
8. **Generate**: `writeNativePackage` writes `.lucent/native`, and
   `classifyChanges` turns what changed into pending actions.

An aborted `signal` (a newer change) stops a build before it publishes.

### Inside `compile()`

`compile(files, options)` in `compiler/src/index.ts` runs in a context
of its own (`compile-context.ts`), which holds its options and records
what it read. So an editor check and a `lucent dev` build in one process
never mix. A `CompileSession` keeps each target's last program, so a
watcher or editor checks only what changed.

**Modules.** `planModules` (`platforms.ts`) splits the files into shared
modules and platform modules. A platform module is `name.lucent.ts`,
which only declares exports, and `name.ios.lucent.ts` or
`name.android.lucent.ts`, which implement them. A target without its
platform's file compiles the declaration as stubs that throw or reject.
A shared module may branch on `PLATFORM` from `lucent:platform`.

**Programs.** Without platform code, one program serves every target,
and its identity says `all`. Otherwise each target gets a TypeScript
program (`createLucentProgram` in `program.ts`): `ios`, `android`, or
`host` for tests and tools. Options are strict with
`noUncheckedIndexedAccess`, ES2024, and JSX from `lucent:jsx`.

SDK imports resolve to declarations generated from binding schemas
(`sdk/dts.ts`), served from a virtual directory. A platform without its
SDK gets untyped modules, so shared code still type-checks.

**Checks.** Each stage stops the compile when it fails. First come
TypeScript's diagnostics, with the declaration files' and platform
scopes' errors. (`platformScopes` gives each top-level declaration the
platform whose SDK it uses, and keeps platform code in its branch.) Then
come conformance (`conformanceErrors`) and the components
(`ui/analyze.ts`, see [Views](#views-in-brief)).

**Generation.** `emitProgram` (`emit/index.ts`) registers classes and
collects top-level declarations first. Then it lowers classes (bases
first), functions, component setups, each module's `init()` and compute
task variants, and writes the files.

Unsupported code fails with `fail(node, Codes.X, …)`, and `Ctx.guard`
(`emit/context.ts`) records it for that unit while the others compile.
An internal fault is `LUCENT9002` at its function (`ir/cpp.ts`). A failed
compile writes nothing.

**Merging.** Each target's files go under `<target>/`, and proxies,
declarations and identities merge. `ui/merge.ts` refuses a component
whose description differs between platforms.

### Program analyses

`analysis/` summarizes once per program and target what each unit may
do. A unit is a function, closure, method, accessor, a class's
construction or a module's initialization (`units.ts`), without other
platforms' branches.

- `local.ts`: each unit's own facts (module state, allocation, throws,
  suspension, native calls) and a graph of how values flow.
- `native.ts` and `library.ts`: facts from binding plans (thread,
  blocking, callbacks) and from the built-ins. Absent facts are unknown.
- `solve.ts`: joins each unit's facts with its callees', its callbacks'
  and the Lucent code native code may call back, up to a fixed point.
  A fixed order keeps the first cause, so builds explain alike.
- `ownership.ts`: whether a unit may run on a compute task or the main
  thread, and whether a value may cross contexts. A refusal prints its
  cause path: "`run` calls `decode`, which reads module state `cache`".
- `main-state.ts`: module variables only main-thread code uses, which
  `init()` assigns on the main thread.

`programFacts(lp)` (`analysis/index.ts`) is the entry point. The IR takes
effect records from it, and compute, buffers, channels and views use its
checks.

### The semantic IR

`ir/` is a typed representation between the checker and the C++ tree.
Each value is defined once by an operation, and operations run in their
region's order (`ir/ir.ts`), so evaluation order is data. Control flow is
structured: `if`, `loop`, `iterate`, `block` and `try` own regions, which
`break`, `continue`, `return`, `throw` and `yield` leave.

- `ir/lower.ts` lowers TypeScript, appending each subexpression in
  JavaScript's order. A right side that may not run (`&&`, `??`, `?:`)
  goes in a branch.
- What the IR doesn't model (member access, runtime and SDK methods,
  constructions, array and object literals) is a `plan`. Its code comes
  from `emit/leaf.ts`, over operands the IR lowered first in source
  order. So built-in and SDK semantics are written once.
- `ir/verify.ts` checks each function before any C++ exists: definitions
  before uses, types, terminators, jump targets, spans and effect claims.
- `ir/cpp.ts` makes each operation that does something its own
  statement, with names or literals as arguments. So C++'s unspecified
  argument order never matters.

`emit/through-ir.ts` is the one way in: functions, methods, accessors,
constructors, `init()`, task variants and component setups all lower
through it.

### Lowering choices

- **Types** (`types.ts`): `TypeRegistry.lower` maps a checker type to an
  `LType`. `T | undefined | null` is `opt`, other unions `union` (a
  `std::variant`). Object types with the same fields share one struct:
  `S_<name>`, or `S_Object_<hash>` for an anonymous shape.
- **Classes** derive from `lucent::Object` (`lucent::ErrorObject` under
  `Error`), with `virtual` members in a hierarchy (`emit/classes.ts`). An
  implemented interface is an abstract base (`emit/interfaces.ts`).
  Generics are templates, checked per instantiation
  (`emit/instantiations.ts`).
- **Integers** (`emit/integers.ts`): a local whose every write is an
  exact integer lives in an `int32_t`, `uint32_t` or `int64_t`.
  Arithmetic qualifies only when a range analysis proves every value
  exact within ±2^53 and never -0.
- **Closures** are `lucent::Fn` values. A variable that closures capture
  and code writes later lives in a shared box (`analysis/scopes.ts`).
  Captures that may hold objects make a `lucent::Closure`, for cycle
  reports. An arrow passed once to a callback method such as `map` stays
  a plain lambda (`directCallback` in `ir/cpp.ts`).
- **Coroutines**: async functions return `lucent::Promise<T>`, generators
  `lucent::Iter<T>`. A coroutine takes its captures as parameters, never
  by reference. An async function that never awaits is a plain function
  (`eagerAsync`).
- **`try`/`finally`**: a jump past a `finally` goes through it with a
  completion code, as C++'s `break`, `continue` or a `goto`. `using` is a
  `finally` that disposes.
- **Small things**: an object literal only its local's field accesses see
  is a C++ value (`emit/stack-objects.ts`). Each function calls
  `lucent::checkStack` on entry, so runaway recursion throws
  `RangeError`. Each file undefines the program's names that a header
  may define as macros (`emit/macros.ts`).
- **Positions**: `#line` names each source relative to the project
  (`lowering/source.ts`), and the builds map the project to `.`
  (`-ffile-prefix-map`). Debuggers, crash reports and errors
  (`lucent::withSite`) point at `.lucent.ts` lines, with no machine path.

### Generated files

`cpp/generated/`, or `cpp/generated/<target>/` with platform code:

| File                                 | What it is                                                             |
| ------------------------------------ | ---------------------------------------------------------------------- |
| `lucent_app.h`                       | The runtime's headers, the actor accessors, native object declarations |
| `lucent_app_<Type>.h`                | One type's definition and inline code (`emit/type-headers.ts`)         |
| `lucent_app_json.h`, `…_json_read.h` | JSON readers                                                           |
| `m_<module>.h`, `m_<module>.cpp`     | A module; `.mm` for iOS code using the SDK or SwiftUI                  |
| `lucent_bindings.cpp`                | Module installers, prototypes, conversions, `resetModuleState`         |
| `lucent_identity.cpp`                | The build identity, after a `static_assert` on the runtime ABI         |
| `LucentShims.swift`                  | Swift-only members the glue calls (`@_cdecl` functions)                |
| `views/…`                            | Components' Fabric sources, mounts and hosts                           |

Headers per module and per type keep a rebuild to the units that use
what changed.

### Swift, Kotlin and Java

- **Swift** (`emit/swift.ts`, `emit/swift-proxy.ts`): a `@_cdecl` shim per
  Swift-only member, and a Swift class for a Lucent class conforming to a
  Swift-only protocol ([design/swift-shims.md](design/swift-shims.md)).
  The pod then sets `swift_version`.
- **Objective-C** (`emit/delegates.ts`, `emit/objc-subclass.ts`): an
  object for a Lucent class implementing SDK protocols, and a subclass
  for one extending an iOS class.
- **Kotlin** (`emit/kotlin.ts`): shims in `dev.lucent.shims` for suspend
  functions, Kotlin defaults and value classes. The library then applies
  the Kotlin plugin and depends on kotlinx-coroutines 1.7.3.
- **Java** (`emit/java.ts`): a subclass in `dev.lucent.generated` for a
  Lucent class extending an Android class, forwarding to C++ through
  `NativeProxy`.

**Native extensions.** A Lucent package may declare C extensions,
imported as `lucent:ext/<name>`. `extensions/bind.ts` reads the header
with bindgen's `extractCHeader` and checks the declaration against it.
`emit/extensions.ts` converts each argument and calls the C function
inside `lucent::ext::call` (see
[lucent-packages.md](lucent-packages.md#c-extensions)).

> **Planned:** C++ headers, callbacks and prefab ([T142](tasks.md#t142)).

### Build records

Each run of `buildProject` writes `.lucent/build-record.json`
(`src/cli/build-graph.ts`), keeping the one before as
`build-record.previous.json` for `lucent doctor`. It holds:

- **Nodes**: each step's id, kind, status (`ok`, `cached`, `failed`,
  `skipped`), inputs and outputs. Each input or output is a
  project-relative path or a key with a content hash. So the same inputs
  give the same nodes on any machine. The check's inputs include every
  file the compile read (`compiler/src/reads.ts`).
- **Timings** and **startedAt** per node, outside the node hashes, which
  `lucent trace` lays out.
- **Pending actions** (below). `requiredAction` keeps the older
  single-action form.

### Caching

A build or check answers from the last passing one while nothing it used
changed. Its record is `.lucent/check.json` for a check, and the native
package's `manifest.json` for a build. `upToDate`
(`compiler/src/native-package.ts`) accepts it when:

- the key matches. `inputsKey` hashes the sources, the compiler, the
  runtime, the SDKs and the output directory; the pipeline adds the
  targets and the packages' native needs;
- every file the check read reads the same, and a missing one is still
  missing;
- every path where resolution followed a link leads where it did.

`--force`, `--frozen` and a missing `.lucent/sdk-usage.json` always build
again. `writeNativePackage` then writes only what changed, each file
through a temporary file renamed over it (`writeWhole`). Unchanged files
keep their mtime, so native builds reuse their objects. `manifest.json`
goes last, because Metro keys its cache on it.

### Pending actions

`classifyChanges` (`src/cli/changes.ts`) derives what the app needs from
what changed in the native package. A package's file is classified by
the `lucent.json` field that lists it, never by its extension.
`lucent build --json` reports them as `actions`.

| Changed                                                                              | Action                          |
| ------------------------------------------------------------------------------------ | ------------------------------- |
| `js/` proxies                                                                        | `reload-js`                     |
| `cpp/`, `ios/`, `android/src/main/java/`; a package's `nativeSources`                | `compile-native`                |
| A package's `resources`, `resourceBundles` or `assets`                               | `repackage`                     |
| The podspec, other `android/` files; `libraries`; pods, Gradle artifacts or `minSdk` | `relink`                        |
| `AndroidManifest.xml`; Info.plist keys or entitlements in `resolved.json`            | `reinstall`                     |
| A file iOS builds added or removed                                                   | `relink` on iOS (`pod install`) |
| `types/`, `manifest.json`, `js/_lucent/identity.js`                                  | nothing                         |
| Anything else                                                                        | `relink`                        |

### Build identity

The app binary and the JavaScript bundle are built apart and may come
from different sources. `emit/identity.ts` gives each compile:

- the **runtime ABI** (`RUNTIME_ABI`, the runtime's `kRuntimeAbi`), which
  `lucent_identity.cpp` asserts at compile time;
- per target (`ios`, `android`, `host` or `all`), the **program hash** of
  the generated files, without `#line` lines and trace sites' positions;
- per target and module, the **API hash** of what JavaScript sees:
  exports, signatures, the types that cross, components' contracts.

The native side answers `__lucentIdentity` with `{host, runtimeAbi,
reactNative, target, program, modules}`, `reactNative` being the release
the TurboModule was compiled against. Each proxy passes the loader
`js/_lucent/identity.js`, and the loader (`runtime/js/index.js`) compares
the two. Its errors carry `code: "LUCENT_NATIVE_MISMATCH"` and an
`action`:

| The app's native code                             | Result                                |
| ------------------------------------------------- | ------------------------------------- |
| has no identity                                   | error, `compile-native`               |
| has an older (newer) runtime ABI                  | error, `compile-native` (`reload-js`) |
| was built for an older (newer) React Native minor | error, `compile-native` (`reload-js`) |
| is for a target this JavaScript wasn't built for  | error, `compile-native`               |
| lacks the module, or has another API for it       | error, `compile-native`               |
| has the same APIs and another program             | a warning, once per host and build    |

### SDK usage and the lock

The compiler notes each binding plan it accepts (`sdk/usage.ts`). A
passing check writes them to `.lucent/sdk-usage.json`, with the artifacts
each schema came from. `lucent sdk lock` copies that to
`lucent-sdk.lock.json`, and `--frozen` builds stop when the SDKs or
symbols differ (`src/cli/sdk-usage.ts`). `--schemas` also exports the
schemas, so a machine without a platform's SDK can type its code.

Besides those records, `.lucent/` holds `file-hashes.json` (package files'
hashes by their stats), `android-classpath.json` and its `.state.json`,
`gradle.lock` while a build runs Gradle, and `trace.json` from
`lucent trace`.

### Watching

`lucent dev` (`src/cli/dev/session.ts`) watches the app, each Lucent
package outside it, and the directory of each file the last build read.
A change rebuilds when the last build read the file, or when it is a
module, `package.json` or `lucent.json` outside dependencies.

Saves are debounced (40 ms). A change during a build aborts it before it
publishes, and one build follows. Builds never read what builds write.

## The native package

`.lucent/native` is a React Native library that autolinking finds
through the app's `react-native.config.js`.

| Path                                     | What it is                                                   |
| ---------------------------------------- | ------------------------------------------------------------ |
| `cpp/lucent/`, `cpp/third_party/`        | The runtime, Dragonbox, QuickJS's `libregexp` and Ada        |
| `cpp/rn/`                                | The TurboModule and the view hosts                           |
| `cpp/generated/`                         | The program (see [Generated files](#generated-files))        |
| `LucentNative.podspec`, `ios/`           | The iOS pod and its registration                             |
| `android/`                               | CMake files and the Android library                          |
| `react-native.config.js`, `package.json` | What autolinking reads                                       |
| `packages/<package>/`                    | Files Lucent packages list in `lucent.json`                  |
| `prebuilt/`                              | The prebuilt runtime core, when it matches                   |
| `js/`                                    | Proxies, the loader, the views runtime, the identity         |
| `types/`                                 | `lucent:*` declarations for the app, components' React types |
| `resolved.json`, `manifest.json`         | Merged native needs; module list, check record and identity  |

### iOS

`LucentNative.podspec` compiles `cpp/**` and `ios/**` (not other targets'
code) as C++20 with `-ffp-contract=off` and the prefix map, precompiling
`cpp/lucent/prefix.h`. `podspec()` (`native-build-files.ts`) adds the
frameworks, the packages' pods, sources and resources, Swift packages
(`spm_dependency`), and the highest deployment target asked for.

`ios/LucentRegistration.mm` registers the C++ TurboModule `Lucent` from
`+load`, with no codegen or app delegate change, and throws on a second
copy.

> **Planned:** no iOS build phase runs `lucent build`, so an Xcode build
> is current only after Metro's watcher or `pod install` ran. And
> `expo prebuild` stops at a package pod not yet installed
> ([T141](tasks.md#t141)).

### Android

`react-native.config.js` declares a C++ module
(`cxxModuleHeaderName: "LucentModule"`) and a Java package,
`dev.lucent.LucentPackage`, which gives React Native the components' view
managers. With components it also lists their `componentDescriptors`
(`ui/android.ts`).

- `android/CMakeLists.txt` builds `lucentnative`, an `OBJECT` library
  React Native links into `appmodules`, plus `packages.cmake` for
  packages' C and C++ sources.
- `android/codegen/` (an empty `react_codegen_lucentnative`) and
  `include/lucentnative.h` (a null module provider) satisfy what
  autolinking links and calls for every library.
- `android/build.gradle` is the library with the runtime's Java
  (`NativeProxy`, `LucentActivities`, the view hosts).
  `libraryBuildGradle` adds Kotlin, Compose and package dependencies.
- `AndroidManifest.xml` merges the permissions the called SDK methods
  need, `LucentInitializer` (Activity tracking from process start) and
  `LucentRequestActivity` (results and permissions).

### Autolinking, Gradle and Expo

- **Autolinking** (`autolink/index.cjs`): `lucent init` writes the
  config entry as `require("@lucent-lang/lucent/autolink")(__dirname)`.
  It runs `lucent build` first when `.lucent/native` is missing or older
  than a module or `package.json`, so a fresh clone links Lucent.
- **Gradle** (`gradle/lucent.gradle`): `lucentBuild` runs before each
  project's `preBuild`, after `lucentClasspath`
  (`lucent-classpath.gradle`), which writes the app's compile classpath,
  `minSdk` and `compileSdk`. A standalone build runs that task through an
  init script, leaving the app's build files alone.
- **The Gradle race**: Gradle configured the Lucent library before
  `lucentBuild` ran. A build inside Gradle that changes the library's
  `build.gradle` writes it and fails, asking for another build. After
  `expo prebuild`, the deferred `build.gradle` is configured for every
  Kotlin and Compose need (`deferredLibraryGradle`).
- **Expo** (`app.plugin.js`): during prebuild it runs `lucent build`
  with `LUCENT_NO_GRADLE=1`, links the package, applies the Gradle task,
  and adds the packages' Info.plist keys and entitlements. Keys the app
  sets win; arrays gain the values they lack.

### The prebuilt core

The core is the runtime's `lucent/*.cpp` files that reach no JSI, React
Native or fbjni header, plus the regular expression engine
(`compiler/src/prebuilt-runtime.ts`). `scripts/prebuilt-runtime.ts`
builds it per target, and a build copies it only when its `sourcesHash`
and source list match this runtime. The podspec then links
`LucentCore.xcframework`, and CMake `liblucentcore.a`, instead of
compiling those sources (`LUCENT_RUNTIME_FROM_SOURCE=1` turns this off).

## The JavaScript side

### The loader and proxies

Each module's proxy (`js/<module>.js`, from `jsProxy` in `emit/index.ts`)
calls the loader's `loadModule` with the module name, a function giving
`require("react-native").TurboModuleRegistry`, and the identity. It
requires `react-native` from the app's location, so a monorepo's second
copy is never picked. Classes go through `lucentClass`, so `new` and
`instanceof` work, and enums are frozen objects. A primitive literal
constant is copied once; other exported values are getters, so an
exported `let` is live.

The loader (`runtime/js/index.js`) gets the `Lucent` TurboModule, checks
the [build identity](#build-identity) and returns the module's exports.
Test hosts install modules as `globalThis.__lucentModules` instead. In a
debug build it also warns, in LogBox, of the reference cycles the last
teardown found.

### Metro

`withLucent` (`metro/index.cjs`) wraps a Metro config:

- Its Babel transformer (`metro/transformer.cjs`) bundles a
  `*.lucent.ts(x)` module as `module.exports = require(<proxy>)`, a
  module Metro watches. A rebuilt proxy needs a reload, not a restart. A
  module not yet compiled fails the transform, which Metro retries.
- A module whose last build failed fails the transform with that build's
  diagnostics from `.lucent/problems.json`, shown in the RedBox.
- The cache key covers the package's path, its module list and JS dev
  mode. The resolver maps `lucent:views` to `js/_lucent/components`, and
  adds the app's `node_modules` for a package outside the app
  (`LUCENT_OUT`).
- On a dev server it starts `lucent dev --compact` (`LUCENT_WATCH=0`
  stops that).

### JS dev mode

With `withLucent(config, { js: true })` or `LUCENT_JS=1`, Metro bundles
each `*.lucent.ts` module as its own JavaScript (`metro/js-dev.cjs`), so
a body edit is a Fast Refresh. `lucent:core` is `compiler/lib/core.cjs`,
and platform modules throw `LUCENT_JS_DEV_NATIVE` when used. `.lucent.tsx`
modules keep their native proxies, and release bundles refuse the mode.

### Editor plugin

`ts-plugin/index.js` is a TypeScript language-service plugin. The
editor's `typescript` may differ from the compiler's, so the plugin
imports the compiler asynchronously and passes paths and unsaved text,
never ASTs. It checks the files `lucent build` compiles (`filesInBuild`),
and resolves each Lucent `.tsx` file's JSX runtime to its toolkit.

## The runtime

`packages/runtime/cpp/lucent` is C++20 with no dependency beyond the
standard library and the vendored Dragonbox, `libregexp` and Ada (the URL
standard's parser, which only `url/url.cpp` includes). Only
`lucent/jsi/` knows JSI. `lucent/platform/` is the Objective-C++ and JNI
glue, and `cpp/rn/` the TurboModule and view hosts.

### Values and async functions

`core.h` sets the value model. A value is a primitive held by value
(`double`, `bool`, `String`), or a handle to a reference-counted object
(`Array`, `Map`, `Set`, `Dict`, `Bytes`, `Fn`, `Promise`, `Ref<T>`).
Copying a handle aliases the object, as JavaScript assignment does.
`Opt<T>` holds `T | undefined | null`, and `Union<…>` other unions.

There is no cycle collector: a cycle of strong references lives until
the process ends. `weak.h`'s `WeakMap` and `WeakSet` drop an entry with
its key's last strong reference.

- `jsstring.h`: an immutable, shared UTF-16 string with a Latin-1 form.
  The handle is 16 bytes and holds a one-byte string of up to 15 units.
  A sole owner's `+=` appends in place.
- `number.h`: ECMAScript number semantics, with Dragonbox for shortest
  round-trip digits.
- `bigint.h`: `bigint` at any precision. A value that fits in 64 bits is
  inline; a larger one shares immutable 32-bit limbs. Results beyond
  2^30 bits throw `RangeError`, as V8 does.
- `array.h`, `map.h`, `bytes.h`, `date.h`, `regexp.h`, `json.h` and
  `generator.h` are the other built-ins. Seeded corpora check numbers
  and bigints against Node (`test/number`, `test/bigint`).

`async.h` makes `Promise<T>` a coroutine type. A body starts at once, and
an `await` of a promise resumes from the microtask queue, never inline, as
in JavaScript. An `await` of a plain value doesn't suspend, a known gap
([semantics.md](semantics.md#async-functions-and-microtasks)). A
continuation resumes on the context that registered it, so a coroutine
stays on the context it started on.

### Execution contexts and actors

An execution context (`execution.h`) runs turns in order. Each turn runs
its job, then the context's microtasks. Contexts never wait for each
other: work crosses as posted jobs that own what they carry.

| Context                    | Runs on                                     | Used for                                 |
| -------------------------- | ------------------------------------------- | ---------------------------------------- |
| An `Actor` (`scheduler.h`) | Its thread, or any thread holding its lock  | Module code of one import component      |
| The main context           | The platform's UI loop                      | Views, `main()` callbacks, UIKit objects |
| An `IsolatedContext`       | A thread of its own                         | Compute workers                          |
| An `ExecutorContext`       | A serial dispatch queue (Apple) or a thread | `lucent:thread`'s executors              |

`emit/actors.ts` gives each import component (a package, or the app's
own modules) an actor, `lucent_app::actor_N`. So a long job in one
package delays neither another package nor the main thread.

Every entry into module code holds its actor's lock (`LucentScope`): a
JavaScript call, a turn on the actor's thread, a platform callback
(`callNow`). The lock is a fair ticket lock. The main thread never takes
a ticket: it waits only for the holder in place, or defers
(`enterFromMain`). A nested wait that would close a cycle throws
`Lucent: deadlock` (see [semantics.md](semantics.md#concurrency)).

`native.h` holds the platforms' ways in: `postCallback` and `callNow`
enter module code, `postTo`, `callNowIn` and `runIn` another context,
`enterOrPost` an executor's (a function handed over with `on(exec, f)`),
and `runOnMain` is `lucent:thread`'s `main()`. On Android an executor is
a `dev.lucent.LucentExecutor` (`executorOf`), on iOS its dispatch queue
(`queueOf`). A `NativeRef` releases its
object on the context it names (the main context on iOS). Module work
belongs to the JavaScript runtime it runs for (`RuntimeEntry`,
`ownedScope()`), so tearing one down cancels its work only.

A runtime Lucent's functions are carried into (a worklet's) calls through
a host attached to it, whose work is its own but which is never the
default runtime and holds no module state
([0123](decisions/0123-a-runtime-that-calls-lucent-gets-a-host-there.md)).

### Scopes, operations and resources

- `scope.h`: a `Scope` owns child scopes, pending operations and
  cleanups, and disposing it ends them once. An `Operation` settles once
  from any thread; what loses the race is released, never delivered.
- `operation.h`: `nativeOperation` turns native work that completes on
  any thread into a promise of the calling context. Aborting or disposing
  cancels it.
- `callback.h`: `fromCallback` and `subscribe` turn callback APIs into a
  promise or a subscription, run on the calling context.
- `resource.h`: a `Resource` closes once, at `close()`, its scope's
  disposal or its last reference. `handle.h`'s `NativeHandle` is an
  address valid until `release()`; `platform/ios.h` and `android.h` make
  them of platform objects. `Object::lucentNativeSize_()` is the native
  memory the host reports to the collector (`jsi/host.cpp`).
- `events.h`: `EventEmitter` keeps listeners by event index, and
  `onObserved` reports an event's first listener and its last.
- `abort.h`: an `AbortSignal` belongs to its context. One from JavaScript
  is mirrored natively and aborted on the JS thread.

### Compute, channels and buffers

`compute(entry, input)` (`compute.h`) runs a compiled function on a
bounded pool: one worker fewer than the cores (at least one), and a queue
of 1024 tasks. A full queue rejects at once with `QuotaExceededError`.
Workers never take an actor's lock or wait for the UI loop.

A cancelled task leaves the queue, or stops at its next safepoint
(`TaskContext::checkCancelled`). `emit/compute.ts` writes a task entry
per computed function and a variant whose loops check for cancellation.

`transport.h` copies a task's input into a graph only the task holds.
Each object is copied once, so aliases and cycles survive, and strings
cross as they are. A subclass instance behind its base type is refused
with `DataCloneError`.

- `channel.h`: `Channel<T>` carries values from a producer on any thread
  to a consumer on its own context. A send never waits; a full channel
  refuses (`lossless`), replaces (`latest`) or drops the oldest (`drop`).
  A send copies its value as a compute input is copied.
- `buffer.h`: a `NativeBuffer` is bytes native code owns. Access is a
  borrow for one synchronous call: reads share, a write excludes, and a
  conflict throws `InvalidStateError`. `transfer()` moves the storage,
  which is how a buffer crosses to a task. `emit/buffers.ts` refuses a
  borrowed span that escapes its callback. `adoptReadOnly` holds bytes no
  one may write: a frame `platform/ios_pixels.h` or `android.cpp` locked
  for reading.
- `bytes.h`: an `ArrayBuffer` and its `Uint8Array`s share storage. Bytes
  cross the boundary as copies, but a result nothing else holds moves to
  JavaScript. A synchronous export that only reads a byte parameter is
  lent JavaScript's bytes (`emit/lent-bytes.ts`).

### The JSI host and conversions

`jsi/host.h` defines one `Host` per JavaScript runtime. It owns every
JSI reference Lucent keeps: promise resolvers, retained callbacks and
values, prototypes and the identity cache. JSI values are touched only
on the JS thread, so other threads use ids and post to it (`postToJs`).

- `LucentModule` (`cpp/rn/LucentModule.cpp`) creates the host on first
  access, and answers each property with a module's exports, built once
  per host while holding the module's actor.
- `Host::create` replaces the runtime's previous host. It runs each
  module's `init()` (`resetModuleState`, in import order) only when no
  other runtime is live, because module state is process-wide.
- `jsi/convert.h` defines `Convert<T>`, and the compiler writes
  specializations for structs, classes and unions. A value that doesn't
  convert throws a `TypeError` naming the function and the argument.
  Where a `T | undefined` or `T | null` sits inside a container, a
  callback or a promise, the compiler spells it `OrUndefined<T, …>` or
  `OrNull<T, …>`, which refuse the other absent value; `ValueOf` maps a
  spelling to the C++ type it converts to.
- `callSync` runs an export under the actor's lock on the JS thread.
  `callAsync` posts a job to the actor's thread and returns a JS promise,
  settled later on the JS thread.
- A JavaScript callback called off the JS thread posts to it. One that
  returns a value must then return a promise.
- A class instance has one JS object per runtime. Prototypes are kept on
  the runtime's global object (`__lucentPrototypes`).

### Lifecycle and teardown

A host tears down on a reload, at the runtime's end (an anchor object on
`global` notices), or when a new host replaces it. `Host::tearDown`:

1. rejects the JS promises it owes with an `AbortError`, while the
   runtime is still usable;
2. runs module code's `onDestroy` hooks (`hooks.h`) in each actor;
3. disposes its scopes, cancelling this runtime's operations, tasks and
   subscriptions;
4. drops every JSI reference. A task for the JS thread that never ran is
   released on the actor that posted it.

A native instance whose host is gone is refused with a `TypeError`.
`lifecycle.h` reports app and scene events on the main thread, fed by
UIKit notifications (`platform/ios_ui.mm`). Android's Activity events
come through `LucentActivities` (`platform/android_activity.cpp`).

> **Planned:** app-delegate events such as opened URLs and push tokens
> ([T110](tasks.md#t110)).

### The reactive graph (`reactive.h`)

`reactive.h` is the UI's reactive graph: signals, computed values and
effects owned by one execution context, the main one for views. A call
from another thread throws `std::logic_error`. Nothing in it takes an
actor's lock or waits for the JavaScript thread. The rules:

- **Signals.** A write notifies when it changes the value by `Object.is`:
  NaN is itself, and 0 and -0 differ. An object compares by identity, so
  mutating it in place notifies nothing. `Opt` keeps missing, null and a
  value apart. A signal may take another equality.
- **Computed values** are lazy. One is evaluated when read, and again
  only when a source it read last time changed since. Computed sources
  are brought up to date first, in the order read. An unchanged result
  changes nothing downstream.
- **Computed errors** are kept and rethrown to readers until a source
  changes. A computed value can't write a signal or read itself.
- **Effects** run once when made, then after something they read
  changed. Each run replaces what the last one read. Before an effect
  reruns, or when it or its scope is disposed, its last run's scope is
  disposed, untracked. Its tasks are cancelled first, then its cleanups
  and nested effects run in reverse order.
- **Transactions.** Writes inside a transaction, an effect or a cleanup
  wait for it to end. The outermost end runs the pending effects at once,
  in the order they were made. No effect sees half a transaction, and
  nothing waits for a frame.
- **Tracking.** Only the synchronous run tracks. Cleanups, `untracked()`
  and code after an `await` read without subscribing.
- **Loops.** An effect about to run more than `loopLimit` (100) times in
  one update stops it. The loop is reported with the effects that made
  each other pending, and the rest wait for their next change.
- **Errors** nobody can catch (an effect's, a cleanup's, a loop) go to
  `GraphOptions::onError`, by default `reportUncaught`.

A mount's props reach the graph through a `PropInbox`. A commit is the
changed fields, each a write of an already converted value, posted from
any thread. Commits coalesce until the main thread applies them in one
transaction, so effects see one committed state. Code that must answer
now (a command, a measurement) calls `drain()` first, and disposing the
mount drops pending commits.

`test/reactive/reference.ts` states the same rules in plain JavaScript,
and a seeded corpus (`test/reactive/corpus.ts`) must give the same log on
both. Each effect run is a trace span at its `.lucent.ts` line.

### Debug features

Debug builds (`NDEBUG` unset) add reports:

- **Live counts** (`live.h`, `debug.h`): scopes, operations, resources,
  effects, signals, computed values and native references.
- **Reference cycles** (`refs.h`): each class and struct reports its
  strong references (`lucentRefs_`, emitted in every build so layouts
  never depend on `NDEBUG`). At teardown, `LucentModule` logs new cycles
  as paths of fields, and the native references module code still holds.
- **`__lucentDebug.snapshot()`**: a promise of the live counts, each
  mounted component's native view tree, what the host holds and the
  cycles found. `__lucentDebug.cycles()` gives the cycles alone.
- **`__lucentHost.ownership`**: what the host holds, and `releasedOpen`:
  instances JavaScript dropped while something they held was still open.
- **Main-thread waits** past `mainWaitWarningMs()` are warned about.

In every build, `reportUncaught` (`report.h`) sends errors no Lucent code
can catch to the platform's log and stderr, and `trace.h` records events
when asked ([tracing.md](tracing.md)).

## Views in brief

A component is an exported function of a `.lucent.tsx` module that
returns a platform view, a SwiftUI body or a Compose body. It is
described, not exported as a function.

- `ui/analyze.ts` describes each component (`ui/contract.ts`): identity,
  registration name, props, events, ref commands, children and each
  platform's root class. Setups are checked for the main thread.
- `ui/fabric.ts` writes the Fabric props, events, shadow node and
  descriptor (`views/<registration>.h/.cpp`).
- `emit/setups.ts` compiles each setup through the IR into
  `views/<registration>_mount.cpp`. Props are signals of the main
  context's graph, and events are routes.
- `emit/views.ts` writes the hosts: an iOS view deriving from
  `LucentComponentView`, and Android C++ hosts with Java managers from
  `ui/android.ts`.
- `emit/swiftui.ts` and `ui/compose.ts` write SwiftUI and Compose bodies
  as Swift and Kotlin, fed through `emit/toolkit.ts`.
  `emit/native-jsx.ts` lowers JSX of UIKit and Android views.
- `ui/proxy.ts` adds each component to its module's proxy, and
  `runtime/js/views.js` makes it a React component, imported as
  `lucent:views/<module>`.

[design/views.md](design/views.md) is the full design: the component
model, toolkit bodies, props, events, commands, children, sizing and the
Fabric integration.

> **Planned:** commands that present from a view-controller root
> ([T122](tasks.md#t122)) and native objects in toolkit bodies
> ([T123](tasks.md#t123)).

## Bindings in brief

There is no catalog of SDKs or APIs. Bindgen reads what the app's build
resolved: the iOS simulator SDK, pods, Swift packages and frameworks, and
`android.jar` with the app's Gradle classpath, Kotlin metadata included.
It writes one binding schema per module into a cache
(`$LUCENT_CACHE_DIR`, else `$XDG_CACHE_HOME/lucent` or `~/.cache/lucent`).

The compiler turns schemas into `lucent:*` declarations (`sdk/dts.ts`)
and binding plans (`sdk/plans.ts`). `emit/native.ts` writes each use as
Objective-C++ message sends or JNI calls, with shims where needed.
[platform-bindings.md](platform-bindings.md) covers sources, schemas,
calls and threads.

> **Planned:** SDK shapes Lucent still refuses ([T112](tasks.md#t112)),
> the app's own `lucent.json` ([T111](tasks.md#t111)), typed Kotlin and
> Java package sources ([T143](tasks.md#t143)), and a web target
> ([T144](tasks.md#t144)).
