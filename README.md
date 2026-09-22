<p align="center">
  <img src="assets/logo.svg" width="96" alt="Lucent">
</p>

<h1 align="center">Lucent</h1>

> [!WARNING]
> **Very early and experimental — do not use this in production.**
> Lucent is a research-stage project. The language subset, the generated Swift
> and Kotlin, the CLI and every `@lucent-lang/*` API change without notice and
> without a migration path. Expect gaps, rough edges and bugs. Use it on a
> throwaway or side project, and report what breaks.

Write native React Native modules in TypeScript. Lucent compiles a typed subset
of TypeScript to Swift and Kotlin ahead of time. No JavaScript runs on the
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

squaredDistance({ x: 0, y: 0 }, { x: 3, y: 4 }); // 25, runs in Swift / Kotlin
```

Works with [Expo Modules](https://docs.expo.dev/modules/overview/) (SDK 58)
and [Nitro Modules](https://nitro.margelo.com/) (bare React Native).

## What you can build today

Every item below is executed on both toolchains and runs in the example apps.

- **Computation and data modules** — sync or async functions over numbers and
  sized integers, strings, booleans, records, tagged unions, arrays, maps,
  `Uint8Array` and optionals.
- **Stateless SDK wrappers** — bind real SDK functions through a package
  manifest, with typed capabilities, `Platform.OS` guards, minimum-version
  contracts, thread placement, overload groups and SDK enums.
- **Stateful native objects** — a class whose state stays in native memory
  while JavaScript holds a handle, calls synchronous methods and `dispose()`s it.
- **Cancellable background work** — `@Background`, `CancellationSource`
  checkpoints, and a `TaskScope` close that waits for real completion.
- **Native → JavaScript events** — `event<T>()` emitted natively, subscribed
  from the app.
- **Native views** — `.lucent.tsx` rendered by SwiftUI and Jetpack Compose,
  with controls, keyed lists and scalar view state.
- **Synchronous delegate callbacks** — generated protocol conformances answered
  by compiled Lucent, each with a mandatory typed error policy.

## What you cannot build yet

The gaps cluster around state that outlives a single call.

- **Listener and subscription modules.** No owned subscriptions with idempotent
  removal, no retention where the SDK holds a delegate weakly, no teardown
  quiescence.
- **Session and resource modules** — a capture session, an audio engine, a BLE
  connection, a socket, a file watcher. Use after close is a compile-time error,
  but no runtime close rejects new work, quiesces it and runs SDK cleanup.
- **Views that own native resources.** No component lifecycle: no effects,
  resource slots, mount/visibility separation or typed refs.
- **Whole-SDK import.** Extraction covers public Swift free functions and public
  Java static methods over scalars; anything else needs a curated manifest.
- **Camera-style streaming.** The frame processor compiles and 1,000 synthetic
  frames run through generated delegates with every frame closed, but
  permissions, preview, sessions and backpressure do not exist.

In short: call-in, call-out native work — sync or async, stateless or
handle-based, with native UI on top. Subscription-shaped work is the next
slice. See [what you can build today](https://lucent-lang.dev/docs/what-you-can-build/)
for the detail, and the [roadmap](ROADMAP.md) for every open item and the
evidence it has to produce.

## Docs

- [Getting started](docs/getting-started.md) — install and configure for Expo or bare React Native
- [CLI](docs/getting-started.md#cli) — `npx @lucent-lang/cli init | build | check | doctor`
- [The language](docs/language.md) — what you can write and how it maps to native
- [Roadmap](ROADMAP.md) — what is done and what is next

## How it works

```
*.lucent.ts → compiler → Swift + Kotlin → Expo Module or Nitro HybridObject → JS proxy
```

Metro replaces each `*.lucent.ts` with a generated proxy at bundle time. The
Expo plugin (or `lucent build`) writes the native code during prebuild.

## Contributing

Node 22.12+, pnpm 12. For native checks: Xcode and `brew install kotlin`.

```sh
pnpm install
pnpm test
pnpm verify   # typecheck, lint, format, tests, and compile fixtures with swiftc/kotlinc
```

MIT © Lucent
