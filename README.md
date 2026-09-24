<p align="center">
  <img src="assets/logo.svg" width="96" alt="Lucent">
</p>

<h1 align="center">Lucent</h1>

> [!WARNING]
> **Experimental: not for production.** APIs and the language subset change
> without a migration path.

Write native React Native modules in TypeScript. Lucent compiles a checked
subset to C++ and calls it through JSI. There's no Swift or Kotlin to write,
and nothing runs in a JS engine on the native side.

```ts
// src/geo.lucent.ts
export type Point = { x: number; y: number };

export function squaredDistance(a: Point, b: Point): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return dx * dx + dy * dy;
}
```

```ts
import { squaredDistance } from "./src/geo.lucent";
squaredDistance({ x: 0, y: 0 }, { x: 3, y: 4 }); // 25, computed in C++
```

Works in bare React Native (0.88) and Expo (SDK 58). No Expo Modules or Nitro
dependency.

## Call iOS and Android

A module imports the platform SDKs directly. One module holds both
platforms, and each platform's build compiles its own branch:

```ts
// src/location.lucent.ts
import { PLATFORM } from "lucent:platform";
import { CLLocationManager } from "lucent:ios/CoreLocation";
import { LocationManager } from "lucent:android/android.location";
import { appContext, available } from "lucent:android";

export async function hasServicesEnabledAsync(): Promise<boolean> {
  if (PLATFORM === "ios") {
    return CLLocationManager.locationServicesEnabled();
  } else {
    const manager = appContext().getSystemService(LocationManager);
    if (!manager) return false;
    if (available("android", 28)) return manager.isLocationEnabled();
    return manager.isProviderEnabled(LocationManager.GPS_PROVIDER);
  }
}
```

The SDK types come from your installed Xcode and Android SDK. The full
[`expo-location` port](scripts/example-app/src/sdk/location.lucent.ts) adds a
CoreLocation delegate, an Android listener and positions sent to a JS
callback. It runs in the example apps next to ports of netinfo,
local-authentication, secure-store, haptics and clipboard
([examples](https://lucent-lang.dev/docs/examples/)).

## Install

```sh
npm i -D @lucent-lang/lucent
npx lucent init
```

<p align="center">
  <img src="assets/cli.svg" width="700" alt="lucent build, then lucent check reporting an error with a code frame and its fix">
</p>

`lucent dev` rebuilds as you edit, `lucent doctor` checks your machine,
`lucent explain <code>` explains a diagnostic; `lucent --help` lists the rest
([CLI reference](https://lucent-lang.dev/docs/reference/cli/)).

One package holds the `lucent` command, the compiler, the C++ runtime, the
Metro integration (`@lucent-lang/lucent/metro`), the Expo config plugin
(`"plugins": ["@lucent-lang/lucent"]`) and the editor plugin
(`@lucent-lang/lucent/ts-plugin`). Modules import helpers from the built-in
`lucent:core`. It isn't on npm yet: until it is, install the tarball
`pnpm pack` makes in `packages/lucent`. Walkthroughs:
[install](https://lucent-lang.dev/docs/install/),
[your first module](https://lucent-lang.dev/docs/first-module/).

## Today

- The language: structs, unions, classes, closures, generics,
  `async`/`await`, errors
- JS callbacks, promises and `AbortSignal` across the boundary
- One package, `@lucent-lang/lucent`: `lucent build` / `lucent check`, the
  Metro transformer, the Expo plugin and the editor plugin
- iOS and Android SDKs, typed from your Xcode and Android SDK: one module
  for both platforms, delegates and listeners, completion handlers as
  promises
- Lucent packages: npm packages that ship modules

## Not yet

- Testing on physical devices (simulators and emulators pass)
- Views (M3)
- npm publish

## Docs

[Install](https://lucent-lang.dev/docs/install/) ·
[Examples](https://lucent-lang.dev/docs/examples/) ·
[Language](https://lucent-lang.dev/docs/language/) ·
[How it works](https://lucent-lang.dev/docs/how-it-works/) ·
[Comparison](https://lucent-lang.dev/docs/comparison/) ·
[Roadmap](ROADMAP.md)

## Develop

```sh
pnpm install
pnpm test           # compiler unit tests
pnpm test:runtime   # C++ runtime tests
pnpm test:e2e       # compiled modules vs. the same code as JavaScript
```

The e2e harness needs a local Hermes build (`HERMES_DIR`); see
[docs/testing.md](docs/testing.md). Contributor docs live in [docs/](docs/).

MIT © Lucent
