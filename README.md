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

## Today

- The full language minus platform SDKs and views: structs, unions, classes,
  closures, generics, `async`/`await`, errors
- JS callbacks, promises and `AbortSignal` across the boundary
- `lucent build` / `lucent check`, the Metro transformer and the Expo plugin
- Early platform modules (`*.ios.lucent.ts` / `*.android.lucent.ts`):
  Android bindings generated from `android.jar`, iOS a hand-written UIKit
  subset

## Not yet

- Testing on physical devices (simulators and emulators pass)
- Generated iOS bindings, delegates and protocols (M2)
- Views (M3)
- npm publish

## Docs

[Getting started](https://lucent-lang.dev/docs/getting-started/) ·
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
