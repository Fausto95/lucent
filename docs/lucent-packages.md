# Lucent packages

The contributor spec. Users read the
[`lucent.json` reference](https://lucent-lang.dev/docs/packages/lucent-json/).

An npm package can ship Lucent modules. An app that installs it gets them
compiled into its one native package: the same runtime, the same toolchain,
and no prebuilt binaries to keep in step.

## Declaring one

In `package.json`:

```json
{
  "name": "lucent-haptics",
  "main": "index.ts",
  "lucent": {
    "sources": "src",
    "compatible": ">=0.0.3"
  }
}
```

- `sources` is the directory holding the `*.lucent.ts` modules, platform
  files included.
- `compatible` is the range of Lucent versions the package supports (npm
  range syntax; prerelease tags are ignored). An app on a Lucent outside it
  fails to build, and the error names the package.
- `main` re-exports the modules, `export * from "./src/haptics.lucent";`.
  Metro turns each `.lucent` import into the module's JavaScript proxy.

Packages ship sources only.

## Native needs: lucent.json

A `lucent.json` next to `package.json` lists what the package's platform code
needs from the app:

```json
{
  "ios": {
    "pods": { "LucentAuthKit": "~> 1.0" },
    "frameworks": ["LocalAuthentication"],
    "infoPlist": {
      "NSFaceIDUsageDescription": "Unlock with Face ID",
      "UIBackgroundModes": ["fetch"]
    }
  },
  "android": {
    "dependencies": { "androidx.biometric:biometric": "1.1.0" },
    "permissions": ["android.permission.USE_BIOMETRIC"]
  }
}
```

Its fields are typed (`packages/lucent/schemas/lucent.schema.json`, checked
by `PACKAGE_FIELDS` in `packages/compiler/src/package-config.ts`). An unknown
field or a value of the wrong type fails the build, naming the package and
the field. Finding packages does not read `lucent.json`: an invalid one
stops the build, not the editor or `lucent check`.

The app's build merges the files of all its packages (`resolveNative`).
The result does not depend on the order packages are found in, and a
conflict names the two packages that disagree:

| Need                                    | Rule                                                                                                                                                                                                                                  |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ios.frameworks`, `android.permissions` | Set-like: each once, whoever lists it.                                                                                                                                                                                                |
| `ios.pods`                              | Every requirement on a pod goes to CocoaPods, which picks the version (`s.dependency "Kit", ">= 1.2", "~> 1.0"`). Requirements that no version meets (`~> 1.0` and `~> 2.0`) fail. Syntax Lucent does not model is left to CocoaPods. |
| `android.dependencies`                  | Every version of an artifact goes to Gradle, which picks one (the highest, by default). A strict version (`1.0!!`) with any other version fails.                                                                                      |
| `ios.infoPlist`                         | One value per key: strings and booleans must be equal. Arrays join, deduplicated and sorted.                                                                                                                                          |

The merged result goes into the native package:

- **Pods** become dependencies of its podspec, marked `# lucent.json`. A
  build writes them before it checks the modules, so in a bare React
  Native app (its `react-native.config.js` links `.lucent/native`, as
  `lucent init` sets up) a module can import a package's pod before it
  is installed: the first `lucent build` leaves the podspec depending on
  it, fails with LUCENT3004 and names the pod, its package and the next
  steps. Then `pod install` in `ios/` installs it, and the next
  `lucent build` binds it; when that build adds files to the native
  package, or a later one changes the pods (a requirement goes from
  `~> 1.0` to `~> 1.1`), it asks for `pod install` again
  (`iOS: pod install first`).
  `lucent check`, which writes nothing, names the pod and says to run
  `lucent build` first. A pod the packages no longer declare leaves the
  podspec; a pod the code imports that no package declares must be in
  the app's Podfile. Expo apps don't get there yet: the config plugin
  runs `lucent build` in `expo prebuild`, before the pods are installed
  and before it links the native package, and stops at its failure,
  which names no steps.
- A pod binds through the module it defines, as the app target's Pods
  xcconfig gives it (`podsSearchPaths` in `@lucent-lang/bindgen`): a
  `module.modulemap` under its header search paths or passed with
  `-fmodule-map-file`, a `.swiftmodule` in a header search path, a
  prebuilt `.framework` the pod ships under `Pods/` (on its framework
  search paths), or, with `use_frameworks!`, the framework module map and
  umbrella header CocoaPods writes in `Pods/Target Support Files/` and the
  headers the umbrella imports. Built as a static library (React Native's
  default), a pod defines one when its podspec sets `DEFINES_MODULE` or
  the Podfile asks for modular headers (`use_modular_headers!`,
  `:modular_headers => true`). Paths in the build products directory
  (`PODS_CONFIGURATION_BUILD_DIR`) are not read, so a Swift pod built as a
  static library, whose module Xcode writes there, is not bound, nor is a
  pod that ships an `.xcframework`, which CocoaPods copies there
  (`PODS_XCFRAMEWORKS_BUILD_DIR`).
- **Frameworks** join the podspec's `s.frameworks`, with the frameworks of
  the `lucent:ios/*` modules its code imports.
- **Gradle artifacts** are `api` dependencies of its Android library. They
  join the app's compile classpath, so `lucent:android` binds them.
- **Permissions** go into its manifest, which Android merges into the app's.
  Permissions the SDK methods require (`@RequiresPermission`) are added
  without listing them here, including those of a property's getter when
  the code reads it and of its setter when the code assigns it (both for
  `+=`, which reads and assigns).
- **Info.plist entries** are written by the Expo config plugin: a key the
  app sets keeps the app's value, and an array gains the values it lacks.
  For bare apps, `lucent build` names the keys and array values the app's
  `Info.plist` lacks, and does not edit the app's files.

### Entitlements, Swift packages, components and targets

```json
{
  "ios": {
    "swiftPackages": {
      "https://github.com/orbit/orbit-swift": {
        "requirement": { "kind": "upToNextMajorVersion", "minimumVersion": "1.2.0" },
        "products": ["Orbit"]
      }
    },
    "entitlements": { "com.apple.developer.healthkit": true },
    "deploymentTarget": "15.1"
  },
  "android": {
    "components": [
      {
        "kind": "service",
        "name": "dev.orbit.SyncService",
        "exported": false,
        "foregroundServiceType": "dataSync"
      }
    ],
    "minSdk": 26
  }
}
```

| Need                   | Rule                                                                   | In the native package                                                                                                                                                |
| ---------------------- | ---------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ios.entitlements`     | As `infoPlist`: scalars agree, arrays join.                            | The Expo config plugin adds them to the app's entitlements like `Info.plist` entries; for bare apps, `lucent build` names what the app's `.entitlements` file lacks. |
| `ios.swiftPackages`    | One requirement per package URL (Xcode records one); products join.    | `spm_dependency(s, url:, requirement:, products:)`, React Native's helper, in the podspec.                                                                           |
| `ios.deploymentTarget` | The highest any package needs.                                         | `s.platforms`: the higher of it and React Native's `min_ios_version_supported`. CocoaPods fails an app target below it.                                              |
| `android.components`   | One declaration per class; packages that declare one differently fail. | `<application>` of the library's manifest, which Android merges into the app's.                                                                                      |
| `android.minSdk`       | The highest any package needs.                                         | The library's `minSdk`: the higher of it and the app's `minSdkVersion`. Android's manifest merger fails an app below it.                                             |

A component's shape is checked (`kind`, a fully qualified `name`,
`exported`, `enabled`, `permission`, `authorities` (required for a
provider), `grantUriPermissions`, `foregroundServiceType`, `intentFilters`
with `actions`, `categories` and `data`, and `metaData`); anything else
fails, naming the package and the field.

### Native files

A package can ship its own native adapter sources, resources, and prebuilt
frameworks and libraries. Each field lists paths relative to the package
that lists them; a path outside the package, missing, or of the wrong kind
fails the build, naming the package, the field and the path.

```json
{
  "ios": {
    "nativeSources": ["native/ios"],
    "resources": ["assets/chime.caf"],
    "resourceBundles": { "OrbitAssets": ["assets/images"] },
    "vendoredFrameworks": ["vendor/Orbit.xcframework"]
  },
  "android": {
    "nativeSources": ["native/android"],
    "resources": ["res"],
    "assets": ["assets/android"],
    "libraries": ["libs/orbit.aar"],
    "nativeLibraries": ["jniLibs"]
  }
}
```

`lucent build` copies every listed file into the native package under
`packages/<package>/<path>` (hidden files such as `.DS_Store` stay behind),
and removes them once a package stops listing them. A build never depends on
what an earlier one left there. The build files refer to the copies:

| Field                     | In the native package                                                                                                                                                                                                    |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `ios.nativeSources`       | Directories whose `.h .hpp .m .mm .c .cc .cpp .swift` files join the pod's `source_files`; each is a header search path. Swift makes it a Swift pod.                                                                     |
| `ios.resources`           | `s.resources`: copied to the app bundle's root under their own names.                                                                                                                                                    |
| `ios.resourceBundles`     | `s.resource_bundles`: bundle name → what it holds. A bundle belongs to one package.                                                                                                                                      |
| `ios.vendoredFrameworks`  | `s.vendored_frameworks`: `.framework` and `.xcframework` directories.                                                                                                                                                    |
| `android.nativeSources`   | Java/Kotlin source roots (`java.srcDirs`; Kotlin applies `org.jetbrains.kotlin.android`). Their C and C++ files join the runtime's CMake target through `android/packages.cmake`, with the directory as an include path. |
| `android.resources`       | `res.srcDirs`.                                                                                                                                                                                                           |
| `android.assets`          | `assets.srcDirs`.                                                                                                                                                                                                        |
| `android.libraries`       | `api(files(…))`: `.aar` and `.jar` files.                                                                                                                                                                                |
| `android.nativeLibraries` | `jniLibs.srcDirs`: `<abi>/lib*.so`, packaged into the app.                                                                                                                                                               |

Two files that would land in the same place of the app fail the build,
naming both packages and files: iOS resources by name at the bundle's root
(namespace one with `resourceBundles`), frameworks by name, Android
file-based resources, assets and native libraries by path, libraries by file
name, and Java/Kotlin sources by path. Android merges value resources
(`values*/`) by name and reports duplicates itself.

Code can import a package's prebuilt frameworks and libraries like the
app's pods and Gradle dependencies: `lucent:ios/<Module>` binds a vendored
framework's module (an `.xcframework`'s through the slice its `Info.plist`
names for the iOS simulator), and `lucent:android/<package>` a library's
classes, before the app's Gradle build has resolved its classpath. A jar or
AAR that the classpath lists again is read once (the first artifact with the
same classes). The bindings are cached on the files' contents, like the
pods'.

`.lucent/native/resolved.json` records the merged needs with the packages
each came from, every listed path with its package and a hash of its files'
paths and contents, and every Lucent package with its version. It holds no
machine-specific path, so the same packages resolve to the same file on
any machine. The build record's resolve step lists each listed path as an
input (`packages/<package>/<path>` and its hash), and the build reruns when
one's content changes.

### Native extensions

A package can wrap a C library, or a C interface over C++, as a native
extension: Lucent code imports its functions and handles from
`lucent:ext/<name>`, and calls them directly, from shared code too, since
both platforms build the C code into the one native package. The header
supplies the signatures; `lucent.json` says what C cannot:

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

The header must be in a directory both `ios.nativeSources` and
`android.nativeSources` list (the implementation is compiled from there,
and generated code includes the header by its path under that directory),
and must compile as C and as C++, declaring its functions in `extern "C"`
when C++ includes it (`#ifdef __cplusplus extern "C" { … }`).
`lucent build` reads it with clang (`$LUCENT_CLANG`, else `clang` on the
`PATH`, else Xcode's, else the newest Android NDK's) and checks every name
and shape the declaration uses against it; a mismatch fails the build,
naming the package and the field
(`extensions.orbit-filter.handles.OrbitFilter.destroy: orbit_filter.h declares no function orbit_filter_free`).

| Field                     | Meaning                                                                                                                                                                                                                                                                                                                                                                             |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `handles`                 | Opaque struct (declared, not defined) → a class of `lucent:ext/<name>`. `create` returns a pointer to it (declare `failsWhen: "null"`) and is the constructor; `destroy` is `void f(T *)`; `methods` name functions taking the handle first. `close()` and `[Symbol.dispose]()` destroy it, once; so does its last reference going. Any use after close throws `InvalidStateError`. |
| `functions.<f>.params`    | What a pointer parameter is: `bytes` read or written (a `Uint8Array`; its `length` parameter gets the array's length), a UTF-8 `string` (`const char *`), or the `error` struct the call fills in. Numbers, booleans and handles need nothing. Nothing escapes the call.                                                                                                            |
| `functions.<f>.failsWhen` | `null`, `negative`, `nonzero`, `zero` or `false`: the call then throws an Error with the error struct's message (copied at once) and code, else `<f> failed`. With `nonzero` or `false` the result is a status and the Lucent function returns nothing. A function with an `error` parameter needs one.                                                                             |
| `affinity`                | `any` (the default: any thread, one call at a time) or `main` (used inside `main(() => …)`, destroyed on the main thread), per handle or function.                                                                                                                                                                                                                                  |
| `blocking`                | Calling the function inside `main(() => …)` is a warning.                                                                                                                                                                                                                                                                                                                           |
| `errors`                  | A struct the header defines: its `message` field (`const char *`), an integer `code` field, and a `release` function the binding calls after every call that takes the struct, once it was read.                                                                                                                                                                                    |

Integers wider than 32 bits (`long`, `size_t`, `int64_t` and their
unsigned forms) are bigints; others are numbers, checked on the way in as
WebIDL's `[EnforceRange]` does. Every header function whose signature
needs no declaration (numbers and booleans) is bound as it is; one that
takes a handle must be named (in `functions` or as a method), since only
its package knows whether it keeps or frees it. One that cannot be bound (a
callback, a variadic function, a struct by value) is listed at the end of
the generated declarations with the reason, unless the declaration names
it, which fails the build. A destroy or release function is never Lucent
code's to call.

Handles stay on the Lucent side: returning one to JavaScript is LUCENT2006.
A Lucent class keeps one and publishes what JavaScript needs:

```ts
import { OrbitFilter } from "lucent:ext/orbit-filter";

export class Filter {
  #native: OrbitFilter;

  constructor(strength: number) {
    this.#native = new OrbitFilter(strength);
  }

  apply(input: Uint8Array): Uint8Array {
    const output = new Uint8Array(input.length);
    return output.subarray(0, this.#native.apply(input, output));
  }

  close(): void {
    this.#native.close();
  }
}
```

C cannot throw, and the C++ behind a C interface must catch what it
throws and report it through the error struct: an exception escaping an
extension function ends the process at the call, instead of unwinding
through Lucent and JSI. Conversions (a closed handle, a number out of
range) throw before the call. A call holds its handles: a `close()` from
another thread while it runs destroys the handle when it returns.

`.lucent/native/types/ext/<name>.d.ts` holds the declarations editors and
tsc read; `resolved.json` records each extension with its package, header
hash and declaration, and the build record's `extract:extensions` node the
inputs its binding read. `packages/compiler/test/fixtures/orbit-filter` is
the example: a C interface over a C++ filter.

## In the app

`lucent build` compiles the app's modules and those of every Lucent package
it depends on, transitively, found as Node resolves them (workspace links
are followed). A package's module is named `<package>/<path under sources>`,
for example `lucent-haptics/haptics`. That name is used for its C++
namespace, its TurboModule registry entry and its proxy
(`.lucent/native/js/lucent-haptics/haptics.js`), so two packages may both
have a `storage` module. App modules keep their file names.

The app's modules are its `*.lucent.ts` files outside `node_modules`, dot
directories, `ios`, `android` and Lucent packages' directories
(`findOwnFiles` in `packages/compiler/src/packages.ts`). A Lucent package
inside the app, such as a workspace under `packages/`, is compiled once,
as a package, when the app depends on it, and left out otherwise. A
package's modules stop likewise at any other package's directory, such as
an example app. A `package.json` with neither a name nor dependencies, such
as `{ "type": "module" }`, makes no package: its folder stays the app's or
the package's, and its modules are named as theirs. `lucent init` and
`lucent bench` look for modules and `*.bench.ts` files the same way.

Lucent code imports another package's modules by path, for example
`import { impactAsync } from "lucent-haptics/src/haptics.lucent"`.

## Examples

`examples/lucent-haptics` and `examples/lucent-secure-store` are the
expo-haptics and expo-secure-store ports, installed in both example apps as
`workspace:*` dependencies. `scripts/smoke-install.ts` installs
lucent-haptics from its tarball into a fresh app.
