<p align="center">
  <img src="assets/logo.svg" width="96" alt="Lucent">
</p>

<h1 align="center">Lucent</h1>

> [!WARNING]
> **Experimental — not for production.** APIs and the language subset change
> without a migration path.

Write native React Native modules in TypeScript. Lucent compiles a checked
subset to Swift and Kotlin ahead of time. Nothing runs in a JS engine on the
native side.

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
squaredDistance({ x: 0, y: 0 }, { x: 3, y: 4 }); // 25 — Swift / Kotlin
```

Works with [Expo Modules](https://docs.expo.dev/modules/overview/) (SDK 58)
and [Nitro Modules](https://nitro.margelo.com/).

## Today

- Functions, records, unions, bytes, async, errors
- Native classes with handles, events, background work, task scopes
- Resources, subscriptions, `resourceScope`, move/copy
- `.lucent.tsx` views with `state()`, `resource()`, and `effect()`
- Camera / BLE / SQLite / location packages as CI stubs (not device-complete)

## Not yet

- Real-device camera / BLE / background OS APIs
- Full IDE and source maps from native toolchains
- npm publish and a stable 1.0

See [what you can build](https://lucent-lang.dev/docs/what-you-can-build/) and
the [roadmap](ROADMAP.md).

## Docs

- [Getting started](docs/getting-started.md)
- [Language](docs/language.md) · [Semantics](docs/semantics.md)
- [Website](https://lucent-lang.dev)

## Develop

```sh
pnpm install
pnpm test
pnpm verify
```

Node 22.12+, pnpm. Native verifies need Xcode and `kotlinc`.

MIT © Lucent
