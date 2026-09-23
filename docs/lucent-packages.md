# Lucent packages

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
    "compatible": ">=0.1.0"
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
    "infoPlist": { "NSFaceIDUsageDescription": "Unlock with Face ID" }
  },
  "android": {
    "dependencies": { "androidx.biometric:biometric": "1.1.0" },
    "permissions": ["android.permission.USE_BIOMETRIC"]
  }
}
```

The app's build merges these across its packages. Each pod, artifact and
Info.plist key gets one value; two packages that disagree fail the build,
and the error names both. The merged result goes into the native package:

- **Pods** become dependencies of its podspec.
- **Gradle artifacts** are `api` dependencies of its Android library. They
  join the app's compile classpath, so `lucent:android` binds them.
- **Permissions** go into its manifest, which Android merges into the app's.
  Permissions the SDK methods require (`@RequiresPermission`) are added
  without listing them here.
- **Info.plist entries** are written by the Expo config plugin; an app's own
  values win. For bare apps, `lucent build` names the keys the app's
  Info.plist lacks, and does not edit the app's files.

## In the app

`lucent build` compiles the app's modules and those of every Lucent package
it depends on, transitively, found as Node resolves them (workspace links
are followed). A package's module is named `<package>/<path under sources>`,
for example `lucent-haptics/haptics`. That name is used for its C++
namespace, its TurboModule registry entry and its proxy
(`.lucent/native/js/lucent-haptics/haptics.js`), so two packages may both
have a `storage` module. App modules keep their file names.

Lucent code imports another package's modules by path, for example
`import { impactAsync } from "lucent-haptics/src/haptics.lucent"`.

## Examples

`examples/lucent-haptics` and `examples/lucent-secure-store` are the
expo-haptics and expo-secure-store ports, installed in both example apps as
`workspace:*` dependencies. `scripts/smoke-install.ts` installs
lucent-haptics from its tarball into a fresh app.
