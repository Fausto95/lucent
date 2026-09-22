# Lucent package model

Target layout for a published Lucent package (roadmap P61):

```text
package.json
lucent.package.json

src/
  index.lucent.ts

native/
  sdk manifests
  overlays

generated/
  declarations
```

`package.json` remains the npm identity. `lucent.package.json` is the Lucent-specific
manifest: platforms, native deps, SDK and compiler contracts, hosts, permissions,
and capabilities. The CLI and hosts will read it for resolution, conflict checks,
and generated platform configuration (P62–P63).

## Interim form (today)

Acceptance and example packages do **not** ship `lucent.package.json` yet.
They use the existing interim surface:

| Piece                                         | Role today                                                          |
| --------------------------------------------- | ------------------------------------------------------------------- |
| `library.json` / in-package `LibraryModule`   | TypeScript surface, bindings, references, native source embeds      |
| App `lucent.config.ts` / `lucent.config.json` | Capability allowlist and library path registration                  |
| Package `native/*.swift` / `*.kt`             | Hand-written adapter bodies, embedded via `scripts/embed-native.ts` |

`@lucent-lang/camera` and `@lucent-lang/fake-sdk` follow that interim form:
export a `LibraryModule`, keep adapters under `native/`, and rely on the app
config for capabilities. Migrate to `lucent.package.json` when P62–P66 land.

## `lucent.package.json` fields (target)

All fields are optional unless noted. Unknown fields are ignored with a
validation warning (see `validateLucentPackage` in `@lucent-lang/host-core`).

### `schemaVersion`

Integer schema version of this manifest. Current target: `1`.

### `name`

Package name, usually matching `package.json` (`@lucent-lang/…`).

### `platforms`

OS targets this package supports:

```json
"platforms": ["ios", "android"]
```

Allowed values: `"ios"`, `"android"`.

### `minVersions`

Minimum OS / API levels required to load the package:

```json
"minVersions": { "ios": "16.0", "android": 26 }
```

- `ios`: string version (e.g. `"16.0"`)
- `android`: API level number

### `nativeDependencies`

Native package manager requirements, resolved by the CLI (P62):

```json
"nativeDependencies": {
  "ios": { "AVFoundation": "*", "CoreMedia": "*" },
  "android": { "androidx.camera:camera-camera2": ">=1.5.0" }
}
```

Keys are framework / artifact identifiers; values are version ranges. The
resolver records CocoaPods / SPM / Gradle choices and fails on unsatisfiable
transitive sets.

### `sdkRequirements`

SDK modules or frameworks the adapters assume are present on device:

```json
"sdkRequirements": {
  "ios": ["AVFoundation"],
  "android": ["CameraX"]
}
```

Distinct from `nativeDependencies`: requirements describe runtime SDK surface;
dependencies describe how the build pulls those SDKs in.

### `compiler`

Semver range of `@lucent-lang/compiler` this package was authored against:

```json
"compiler": ">=0.0.1 <0.2.0"
```

Hosts refuse packages whose range does not intersect the running compiler.

### `hosts`

Supported React Native hosts:

```json
"hosts": ["expo", "nitro"]
```

Allowed values: `"expo"`, `"nitro"`.

### `permissions`

OS permission metadata for generated `Info.plist` / `AndroidManifest.xml`
entries (P63). Requesting permission remains application logic.

```json
"permissions": {
  "camera": { "reason": "Scan documents" },
  "location": { "whenInUse": { "reason": "Nearby places" } }
}
```

Shape aligns with `NativeCapabilities` in `@lucent-lang/core/config`.

### `capabilities`

Logical Lucent capabilities the package needs enabled in the app config:

```json
"capabilities": {
  "camera": true,
  "microphone": true
}
```

Apps still declare the allowlist in `lucent.config.*`; package metadata
documents what consumers must enable.

## Validation

```ts
import { validateLucentPackage } from "@lucent-lang/host-core";

const messages = validateLucentPackage(JSON.parse(text));
// Errors: invalid known fields
// Warnings: "warning: unknown field \"…\""
```

Until packaging tooling reads `lucent.package.json` end-to-end, treat this
document as the contract and keep shipping interim `library.json` packages.
