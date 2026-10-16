# Lucent packages

The contributor spec of Lucent packages: how the build finds them, what
their `lucent.json` declares, and how those needs reach the app. Users read
the website's
[package.json](https://lucent-lang.dev/docs/packages/package-json/) and
[lucent.json](https://lucent-lang.dev/docs/packages/lucent-json/)
references.

A Lucent package is an npm package that ships Lucent modules as sources.
An app that depends on it compiles them into its one native package, with
the same runtime and toolchain as its own modules. Discovery is
`packages/compiler/src/packages.ts`. The `lucent.json` schema is
`package-schema.ts`, and the merge is `package-config.ts`.

## What makes a package

A package.json with a `name` and a `lucent` field:

```json
{
  "name": "lucent-haptics",
  "version": "0.1.0",
  "main": "index.ts",
  "files": ["index.ts", "src"],
  "lucent": { "sources": "src", "compatible": "^0.2.0" }
}
```

| Field               | Default          | Meaning                                                                      |
| ------------------- | ---------------- | ---------------------------------------------------------------------------- |
| `lucent.sources`    | `"."`            | The directory of its `*.lucent.ts` and `*.lucent.tsx` modules, at any depth. |
| `lucent.compatible` | none: any Lucent | The Lucent versions it supports, as an npm range (below).                    |
| `name`              | required         | Without it the `lucent` field is ignored. It starts every module name.       |
| `version`           | `"0.0.0"`        | Shown in errors and recorded in `resolved.json`.                             |
| `dependencies`      |                  | The Lucent packages it needs, followed transitively.                         |

`lucentPackageOf` finds the package of a file: the nearest package.json
with a `name` or `dependencies`. A package.json with neither, such as
`{ "type": "module" }`, makes no package, so its folder stays its parent's.
`main` is not read by Lucent. It re-exports the modules
(`export * from "./src/haptics.lucent"`), and Metro bundles each module's
proxy in its place.

## Module names

`moduleNameOf` in `program.ts` names each module:

| File                                       | Module                   |
| ------------------------------------------ | ------------------------ |
| `lucent-haptics/src/haptics.lucent.ts`     | `lucent-haptics/haptics` |
| `lucent-haptics/src/haptics.ios.lucent.ts` | `lucent-haptics/haptics` |
| `@acme/maps/src/geo/region.lucent.ts`      | `@acme/maps/geo/region`  |
| `src/screens/clock.lucent.ts`, in an app   | `clock`                  |

A package's module is `<package>/<path under sources>`, without
`.lucent.ts`, `.lucent.tsx` or the platform suffix. An app's module is its
file name alone. Two modules with one name fail with LUCENT3010, so two
packages may each have a `storage` module, but an app may not. The name
keys the module's native registration and its proxy,
`.lucent/native/js/lucent-haptics/haptics.js`.

The app's own modules are its module files outside `node_modules`, dot
directories, `ios`, `android` and other packages' directories
(`findOwnFiles`). A Lucent package inside the app, such as a workspace
under `packages/`, is compiled once, as a package, when the app depends
on it. It is left out otherwise. `lucent init` and `lucent bench` walk the
same way.

Lucent code imports another package's module by its file path:
`import { impact } from "lucent-haptics/src/haptics.lucent"`. Importing a
module of a package the app does not depend on fails with LUCENT3001,
which says to add it to the app's `dependencies`.

## Resolution

`lucentPackages(root)` lists the packages an app compiles:

| Rule      | Detail                                                                                           |
| --------- | ------------------------------------------------------------------------------------------------ |
| Start     | The app's `dependencies`.                                                                        |
| Followed  | `dependencies` only, in the app and in each Lucent package. Dev, peer and optional ones are not. |
| Depth     | Transitive through Lucent packages. One that only a plain npm package depends on isn't found.    |
| Lookup    | `node_modules` from the depending package's real directory up. Links are followed.               |
| Each once | Keyed by real directory, so a `workspace:*` link and its target are one package.                 |
| Order     | Sorted by name: the result never depends on the order of discovery.                              |

So a package that takes another as a peer dependency needs the app to
list both. Two copies of one package at different paths fail the build's
resolve step: `lucent-haptics is installed twice (0.1.0 and 0.2.0): the
app can build one copy of a Lucent package`.

Discovery reads no `lucent.json`. An invalid one fails the build, naming
the package and the field, not the editor or package discovery.

The app's root `lucent.json` is not read today: only dependencies declare
native needs ([T111](tasks.md#t111)). The app's own modules get the
Android permissions inferred from the SDK, and nothing else. An app
declares its own pods, Gradle dependencies and plist keys the usual way.

## Compatibility ranges

`compatible` is checked against the version of the
`@lucent-lang/lucent` that runs the command (`lucentVersion`). Outside
the range, check, build, dev builds and the editor report LUCENT3014 at
the package's `package.json`, and nothing is built.
`LUCENT_IGNORE_COMPATIBLE=1` turns it into a warning. `lucent doctor`
reports the same under "Lucent versions".

`satisfies` reads part of npm's syntax: `^`, `~`, `>=`, `>`, `<=`, `<`,
`=`, x-ranges and `*`, spaces for "all of" and `||` for "any of".
Prerelease tags are ignored on both sides, so `0.3.0-rc.1` is `0.3.0`.
Hyphen ranges, a space after an operator and dist-tags never match, so
such a range refuses every version.

## lucent.json

A `lucent.json` next to the package.json lists what the package's platform
code needs from the app. It has three keys: `ios`, `android` and
`extensions`. Every field is typed (`PACKAGE_FIELDS`, `EXTENSION_FIELDS`).
An unknown field or a wrong type fails with
`<package>/lucent.json: <where>: <problem>`.

`packages/lucent/schemas/lucent.schema.json` describes the same fields for
editors, and `packages/lucent/test/lucent-json.test.ts` fails when it and
the checker disagree.

`resolveNative` merges every package's file. Each list and record in the
result is sorted. A conflict names the first two packages that disagree,
so the outcome never depends on discovery order.

### iOS fields

| Field                | Value                               | Merge rule                                                       | In the native package                                                         |
| -------------------- | ----------------------------------- | ---------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| `pods`               | pod → requirement (`"~> 1.0"`)      | Every requirement goes to CocoaPods. Ones no version meets fail. | `s.dependency "Kit", ">= 1.2", "~> 1.0" # lucent.json`                        |
| `frameworks`         | Apple framework names               | Union.                                                           | `s.frameworks`, with those of the `lucent:ios/*` modules the code imports     |
| `infoPlist`          | key → string, boolean or strings    | Scalars must be equal. Arrays join, deduplicated and sorted.     | Through the Expo plugin, or warnings in bare apps (below)                     |
| `entitlements`       | as `infoPlist`                      | As `infoPlist`.                                                  | As `infoPlist`, in the app's `.entitlements`                                  |
| `swiftPackages`      | URL → `{ requirement, products }`   | One requirement per URL. Products join.                          | `spm_dependency(s, url:, requirement:, products:)`                            |
| `deploymentTarget`   | `"15.1"`                            | The highest.                                                     | `s.platforms`: the higher of it and `min_ios_version_supported`               |
| `nativeSources`      | directories                         | Listed paths (below).                                            | `s.source_files` (`.h .hpp .m .mm .c .cc .cpp .swift`), `HEADER_SEARCH_PATHS` |
| `resources`          | files or directories                | Listed paths. One name per bundle root.                          | `s.resources`                                                                 |
| `resourceBundles`    | bundle → files or directories       | One package per bundle.                                          | `s.resource_bundles`                                                          |
| `vendoredFrameworks` | `.framework` or `.xcframework` dirs | Listed paths. One framework per name.                            | `s.vendored_frameworks`                                                       |
| `appExtensions`      | app extension targets               | One declaration per name. A different one fails.                 | A subspec of `LucentExtensions.podspec` each (below)                          |
| `appGroups`          | `group.…` identifiers               | Union.                                                           | The `com.apple.security.application-groups` entitlement                       |

An app extension ([0124](decisions/0124-an-app-extension-is-a-target-built-from-the-code-it-reaches.md))
needs a `kind` (`notificationService`, `share` or `widget`) and a target
`name`. A notification service or share extension names its principal
`class`, and a widget its `provider` and `body`, with an optional
`displayName`, `description` and `families`. Any may add `infoPlist` and
`entitlements` of its own. Its code is named as the package's modules
are, `<package>/<path>#<name>`. An app's own extension of a name replaces
a package's. App Groups join the entitlement's value from
`entitlements`, which must then be an array.

Each extension's code is compiled again on its own: the modules it
reaches through its imports, into `cpp/generated/ios-extensions/<name>/`,
without the JSI units. `LucentExtensions.podspec` builds it in a subspec
of the extension's name, with the runtime's JSI-free core and its iOS
files, under `APPLICATION_EXTENSION_API_ONLY` and `LUCENT_APP_EXTENSION`.
`LucentNative.podspec` leaves those files out.

`ios-extensions.json` in the native package records what adding each
target takes, for the Expo plugin and `lucent init`. That's its subspec,
its Info.plist and its entitlements, with the app's App Groups. It also
holds the one source its target compiles, which links the principal
class. Info.plist keys of the extension that start with `NSExtension` go
in its `NSExtensionAttributes`, and its version keys are its target's
`MARKETING_VERSION` and `CURRENT_PROJECT_VERSION`, set as the app's are.
A principal class the OS can't make with `init` fails the build
(LUCENT3019).

The Expo config plugin adds each target at prebuild (`ios-extensions.js`).
It's an app extension of the app's bundle identifier with the
extension's name, with the app's version, team, deployment target and
devices. Its files go in `ios/<name>/`, the app embeds it and builds it
first, and the Podfile gets a target naming its subspec. A target that's
there already stays as it is. In a bare app, `lucent init` adds the same
from the last build, taking the bundle identifier from the app's target,
and `lucent build` warns while a target is missing.

A pod requirement Lucent can't parse is left to CocoaPods
(`podsCompatible` in `package-versions.ts`). A Swift package requirement
is one of Xcode's kinds: `upToNextMajorVersion`, `upToNextMinorVersion`,
`exactVersion`, `versionRange`, `branch` or `revision`.

### Android fields

| Field             | Value                                      | Merge rule                                                           | In the native package                                       |
| ----------------- | ------------------------------------------ | -------------------------------------------------------------------- | ----------------------------------------------------------- |
| `dependencies`    | `group:artifact` → version                 | Every version goes to Gradle. A strict `1.0!!` beside another fails. | `api("group:artifact:version")`, once per version asked     |
| `permissions`     | permission names                           | Union, with those the SDK calls require (`@RequiresPermission`).     | `<uses-permission>` in the library's manifest               |
| `components`      | activities, services, receivers, providers | One declaration per class. A different one fails.                    | `<application>` of the library's manifest                   |
| `minSdk`          | API level                                  | The highest.                                                         | `minSdk Math.max(<app's minSdkVersion>, <minSdk>)`          |
| `nativeSources`   | directories                                | Listed paths. One Java or Kotlin file per path.                      | `java.srcDirs`; C and C++ files in `android/packages.cmake` |
| `resources`       | `res`-layout directories                   | One file-based resource per path.                                    | `res.srcDirs`                                               |
| `assets`          | directories                                | One asset per path.                                                  | `assets.srcDirs`                                            |
| `libraries`       | `.aar` or `.jar` files                     | One library per file name.                                           | `api(files(…))`                                             |
| `nativeLibraries` | directories of `<abi>/lib*.so`             | One library per path.                                                | `jniLibs.srcDirs`                                           |

A component needs a `kind` and a fully qualified `name`. It may set
`exported`, `enabled`, `permission`, `grantUriPermissions`,
`foregroundServiceType`, `theme`, `configChanges`, `intentFilters`
(`actions`, `categories`, `data`) and `metaData`. A provider needs
`authorities`. Every manifest also holds the runtime's own two
components: the `LucentInitializer` provider and the
`LucentRequestActivity`.

### Listed paths

Paths are relative to the package that lists them (`locate` in
`package-files.ts`). A path outside the package, missing, or of the wrong
kind fails, naming the package, the field and the path. `lucent build`
copies each listed file to `.lucent/native/packages/<package>/<path>`,
leaving hidden files behind. A copy goes when its package stops listing
it.

Two files that land in one place of the app fail, naming both packages
(`landsOnce`). iOS resources collide by name at the bundle's root:
namespace one with `resourceBundles`. Frameworks collide by name, and
libraries by file name.

Android resources, assets, native libraries and Java or Kotlin sources
collide by path. Value resources (`values*/`) are Android's to merge.

### What the build records

`.lucent/native/resolved.json` holds the merged needs, each with the
packages that asked for it. It also holds every listed path with its hash,
every extension, and every package with its version. It has no
machine-specific path, and the Expo plugin reads it.

The build record's resolve step keys on it and on each listed path's
hash, so a changed file or `lucent.json` reruns the build.

## How needs reach the build

`writeNativePackage` (`native-package.ts`) writes the build files from
the templates in `packages/runtime/native` (`native-build-files.ts` holds
the edits). In `lucent build`, before the check runs, `writeLinkedPackage`
(`cli/project.ts`) writes the podspec's pods and the library's Gradle
dependencies. So a build whose check fails for want of a pod still leaves
it declared.

### Android

Nothing needs the app's files. The library's `build.gradle`, manifest and
`packages.cmake` carry every need, and Gradle's manifest merger and
dependency resolution do the rest. An app below a package's `minSdk`
fails in the manifest merger.

Before checking, Lucent resolves the app's classpath with Gradle: the
`lucentClasspath` task, from an init script. So `lucent:android/*` binds
the packages' artifacts in the same build. During `expo prebuild`
(`LUCENT_NO_GRADLE=1`) Android is left to the app's Gradle build, whose
`lucentBuild` task compiles it.

### Info.plist and entitlements

| App  | What happens                                                                                                                                                                        |
| ---- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Expo | `app.plugin.js` adds them in `withInfoPlist` and `withEntitlementsPlist`, from `resolved.json`. A key the app sets keeps the app's value. An array gains the values it lacks.       |
| Bare | `missingAppEntries` warns for each key or array value that `ios/<target>/Info.plist` or `*.entitlements` lacks, "(the Expo config plugin adds it)". It never edits the app's files. |

A bare app's own string value that differs from a package's stands
without a warning.

### Pods

A package's pod binds once the app has installed it. In a bare app, whose
`react-native.config.js` links `.lucent/native` as `lucent init` writes
it, that takes two steps:

1. The first `lucent build` that meets an import of the pod adds it to
   `LucentNative.podspec`, then fails with LUCENT3004. A notice names the
   pod, the package and the next steps (`podsToInstall`).
2. `pod install` in `ios/` installs it. The next `lucent build` binds it.

`lucent check` writes nothing, so it says to run `lucent build` first. A
later change to the pods asks for `pod install` again ("rebuild the app
(iOS: pod install first)").

A marked pod no package declares any more leaves the podspec. A pod the
code imports that no package declares is added unmarked, without a
version, and must be in the app's Podfile.

In an Expo app it takes none. The config plugin's build in `expo
prebuild` (`LUCENT_PREBUILD`) leaves iOS unbound while a package's pod is
missing from `Podfile.lock`, with a warning naming it. The plugin links the
native package, and calls Lucent's CocoaPods hook (`cocoapods/lucent.rb`)
first in the Podfile's `post_install`. Prebuild's `pod install` installs
the pod, and the hook runs `lucent build` once it is installed. It adds
the sources that build wrote to the `LucentNative` target, and links the
frameworks it added, as the next `pod install` would. Every Xcode build
runs `lucent build` again, from the pod's build phase.

A pod that is installed but whose module still isn't found fails with
LUCENT3004, and a notice names the pod and how its module binds
(`unboundPods`).

A pod binds through the module it defines, as the app's Pods xcconfig
shows it (`podsSearchPaths` in `@lucent-lang/bindgen`). That is a module
map from `DEFINES_MODULE` or modular headers, a prebuilt framework, or
the framework CocoaPods writes under `use_frameworks!`. A Swift pod's
module is made from its sources with `swiftc -emit-module` and cached by
content. A failure there is LUCENT3004 with swiftc's errors.

## Native code a package ships

| What                                       | Built by                                                    | Typed in Lucent as                                                         |
| ------------------------------------------ | ----------------------------------------------------------- | -------------------------------------------------------------------------- |
| Swift in `ios.nativeSources`               | The pod, as module `LucentNative`                           | `lucent:ios/LucentNative`: its `public` declarations                       |
| Objective-C, C, C++ in `ios.nativeSources` | The pod                                                     | Not bound, except headers declared as an extension                         |
| Kotlin, Java in `android.nativeSources`    | The library (Kotlin applies `org.jetbrains.kotlin.android`) | Not typed ([T143](tasks.md#t143))                                          |
| C, C++ in `android.nativeSources`          | The runtime's CMake target                                  | Not bound, except headers declared as an extension                         |
| `ios.vendoredFrameworks`                   | Linked and embedded by the pod                              | `lucent:ios/<Module>`; an `.xcframework` by its simulator slice            |
| `android.libraries`                        | `api` dependencies of the library                           | `lucent:android/<java package>`, such as `lucent:android/dev.orbit.shapes` |

Lucent makes the `LucentNative` module from every package's Swift
(`swiftc -emit-module`, against the app's pods) on first import, once per
content. The Swift shims calling it are compiled into the same module.
Write Swift there to wrap an API Lucent can't bind. Prebuilt frameworks
and libraries are bound from the files themselves, cached on their
content (`projectSdk` in `project-sdk.ts`).

## C extensions

A package can wrap a C library, or a C interface over C++, as a native
extension. Lucent code imports its functions and handles from
`lucent:ext/<name>`, from shared code too, since both platforms compile
the C. The header gives the signatures, and `lucent.json` says what C
can't (`extensions/bind.ts` checks one against the other):

```json
{
  "ios": { "nativeSources": ["native"] },
  "android": { "nativeSources": ["native"] },
  "extensions": {
    "orbit-filter": {
      "header": "native/orbit_filter.h",
      "handles": {
        "OrbitFilter": {
          "create": "orbit_filter_create",
          "destroy": "orbit_filter_destroy",
          "methods": { "apply": "orbit_filter_apply" }
        }
      },
      "functions": {
        "orbit_filter_create": {
          "params": { "error": { "error": "OrbitError" } },
          "failsWhen": "null"
        },
        "orbit_filter_apply": {
          "params": {
            "input": { "bytes": "read", "length": "input_length" },
            "output": { "bytes": "write", "length": "output_length" },
            "error": { "error": "OrbitError" }
          },
          "failsWhen": "negative"
        }
      },
      "errors": { "OrbitError": { "code": "code", "message": "message" } }
    }
  }
}
```

The rules for the header:

- It is a `.h` file in a directory both `ios.nativeSources` and
  `android.nativeSources` list. Generated code includes it relative to the
  deepest such directory.
- It compiles as C and as C++, with C linkage under C++
  (`#ifdef __cplusplus extern "C" { … }`).
- clang reads it: `$LUCENT_CLANG`, else `clang` on the `PATH`, else
  Xcode's, else the newest NDK's (`findClang` in `bindgen/src/c-header.ts`).
- An extension's name (a letter, then letters, digits, `_` or `-`) belongs
  to one package.

| Field                     | Meaning                                                                                                                                                                |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `handles.<T>`             | An opaque struct (declared, not defined) becomes a class. `create` returns `T *` and is its constructor. `destroy` is `void f(T *)`. `methods` take `T *` first.       |
| `handles.<T>.affinity`    | `any` (the default: any thread, one call at a time) or `main`.                                                                                                         |
| `functions.<f>.params`    | A pointer parameter: `{ bytes: "read" \| "write", length }` (a `Uint8Array`), `{ string: "utf8" }`, or `{ error: "<Struct>" }`. Nothing escapes the call.              |
| `functions.<f>.failsWhen` | `null`, `negative`, `nonzero`, `zero` or `false`. Failure throws an Error with the struct's message and code. With `nonzero` or `false`, the function returns nothing. |
| `functions.<f>.affinity`  | `any` or `main`: a `main` function is called inside `main(() => …)`.                                                                                                   |
| `functions.<f>.blocking`  | Calling it on the main thread is a warning.                                                                                                                            |
| `errors.<E>`              | A struct with a `message` field (`const char *`), an optional integer `code` and an optional `release` function, called once the struct was read.                      |

Every name is checked against the header, and a mismatch fails naming the
field:
`extensions.orbit-filter.handles.OrbitFilter.destroy: orbit_filter.h declares no function orbit_filter_free`.

Binding rules:

- Integers of 64 bits are bigints, others numbers. Values are checked on
  the way in, as WebIDL's `[EnforceRange]` does (`runtime/cpp/lucent/extension.h`).
- A function of numbers and booleans binds without a declaration. One
  taking a handle must be declared, since only its package knows whether
  it keeps or frees it.
- A function that can't bind (a variadic one, a function pointer, a
  TypeScript keyword as name) is listed with its reason. Declaring it fails.
- A destroy or release function is never Lucent code's to call.
- `close()` and `[Symbol.dispose]()` destroy a handle once, as does its
  last reference going. A use after that throws `InvalidStateError`.
- A handle can't cross to JavaScript (LUCENT2006). A Lucent class keeps it
  and exports what JavaScript needs.

C++ behind a C interface must catch its exceptions: one that escapes ends
the process. A C++ header's classes, callbacks, signals and buffers' bytes
work as [C-EXT](design/contracts.md#c-ext-typed-native-extensions) says,
as do prefab modules and pods' headers. The editor's declarations are
`.lucent/native/types/ext/<name>.d.ts`. The fixture is
`packages/compiler/test/fixtures/orbit-filter`, a C interface over a C++
filter.

## Publishing a package

`lucent create <name> --template library` writes a package to start from
(`cli/templates/projects.ts`):

| File            | Holds                                                                                                                                                                                |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `package.json`  | `main` and `types` at `index.ts`, `lucent` with `compatible: ^<this Lucent>`, `files`, peer dependencies on `@lucent-lang/lucent` and `react-native`, `prepublishOnly: lucent check` |
| `index.ts`      | `export *` of each module                                                                                                                                                            |
| `src/`          | A shared module and a module with iOS and Android code                                                                                                                               |
| `tsconfig.json` | `lucent:*` paths and the editor plugin, `example/` excluded                                                                                                                          |
| `.npmignore`    | `example/` and `.lucent/`                                                                                                                                                            |
| `example/`      | An Expo app that depends on the package with `file:..`, set up as `lucent init --yes` does                                                                                           |

What to ship: the `main` file, the sources directory, `lucent.json` and
every path it lists. The template's `files` has no `lucent.json`, since
it writes none: add both together. Never ship `.lucent/`. Check the
tarball with `npm pack --dry-run`.

Keep `compatible` a caret range of the Lucent you tested, and widen it
with `||` once a new Lucent passes. Before 1.0, a minor Lucent release can
change what compiles. Dependencies on other Lucent packages go in
`dependencies`, never only in `peerDependencies`.

## Testing a package

| Layer                      | How                                                                                                                       | What it proves                           |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------- |
| Shared code, as JavaScript | Jest or Vitest with `lucent:core` mapped to `@lucent-lang/lucent/core` (its JavaScript version)                           | The logic, as JavaScript runs it         |
| The host platform          | `lucent check`; `lucent build --platforms host` (platform code becomes stubs that throw); `lucent bench` for `*.bench.ts` | It compiles; native and JavaScript agree |
| JS dev mode                | `withLucent(config, { js: true })` or `LUCENT_JS=1` in the example app's Metro                                            | The app's flow, with Fast Refresh        |
| The platforms              | The example app as a development build, on a simulator and an emulator                                                    | Platform code and native needs           |

A module that imports `lucent:platform`, `lucent:thread` or an SDK module
has no JavaScript version, so keep tested logic in shared modules. In JS
dev mode, an SDK, extension or toolkit import is a stand-in that throws
`LUCENT_JS_DEV_NATIVE` when used, and `.lucent.tsx` modules stay native
(`metro/js-dev.cjs`). A release bundle refuses the mode. `lucent bench`
needs a desktop Hermes (`HERMES_DIR`).

## In this repository

The eight example packages are in `examples/`, and
`packages/lucent/test/examples.test.ts` compiles each for the host.
`lucent-haptics`, `lucent-orbit` and `lucent-secure-store` are also
`workspace:*` dependencies of both example apps. `scripts/smoke-install.ts`
installs `lucent-haptics` and the `orbit-filter` fixture from their
tarballs into a fresh project.

Each example records what it ran on in `evidence.json`, and its README
states it in the block `node scripts/example-evidence.ts` writes.
`examples.test.ts` fails when they differ.

The tests of this spec:

| Test                                                                                    | Covers                                              |
| --------------------------------------------------------------------------------------- | --------------------------------------------------- |
| `packages/compiler/test/packages.test.ts`                                               | Discovery, module names, compatibility              |
| `packages/compiler/test/package-config.test.ts`                                         | The schema, the merge rules, listed paths           |
| `packages/compiler/test/native-package.test.ts`                                         | The podspec, Gradle, CMake and manifest edits       |
| `packages/compiler/test/extensions.test.ts`                                             | Extension declarations against headers              |
| `packages/lucent/test/lucent-json.test.ts`                                              | The JSON schema against the checker                 |
| `packages/lucent/test/app-plugin.test.ts`, `autolink.test.ts`, `linked-package.test.ts` | The Expo plugin, autolinking, the pre-check package |
