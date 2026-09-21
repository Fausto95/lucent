# Lucent

**Write native React Native modules in TypeScript. Ship Swift and Kotlin.**

Lucent compiles a constrained, fully typed subset of TypeScript into Swift and
Kotlin ahead of time, and exposes the result to your app through
[Expo Modules](https://docs.expo.dev/modules/overview/) or
[Nitro Modules](https://nitro.margelo.com/). There is no JavaScript engine on
the native side: what you write in a `*.lucent.ts` file runs as real native
code on the device.

```ts
// src/geo.lucent.ts
import type { int32 } from "@lucent-lang/types";

export type Point = { x: number; y: number };

export function squaredDistance(a: Point, b: Point): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return dx * dx + dy * dy;
}

export async function checksum(data: Uint8Array): Promise<int32> {
  let sum: int32 = 0;
  for (let i = 0; i < data.length; i++) {
    sum += data[i];
  }
  return sum;
}
```

```tsx
// App.tsx — the import looks like any other module
import { squaredDistance, checksum } from "./src/geo.lucent";

const d = squaredDistance({ x: 0, y: 0 }, { x: 3, y: 4 }); // 25, computed in Swift/Kotlin
const c = await checksum(new Uint8Array([1, 2, 3])); // a Promise backed by a native async function
```

> Lucent is pre-release. The language subset is small on purpose and the API
> will change. See [ROADMAP.md](ROADMAP.md) for what is done and what is next.

## Why

Native modules are where React Native apps go to get fast, and also where most
teams stop: two languages, two build systems, and a JS bridge to keep in sync.
Lucent keeps the whole thing in TypeScript:

- **One source, three targets.** A `*.lucent.ts` file becomes Swift, Kotlin, and
  a typed JavaScript proxy. Your editor already understands it; there is nothing
  new to learn beyond a list of things you cannot do.
- **Types are the ABI.** Every value that crosses the boundary has an exact
  native representation. `any`, arbitrary unions and closures are compile
  errors, with diagnostics written for humans.
- **Real async, real errors, real bytes.** `async` functions become Swift
  `async throws` and Kotlin `suspend`; `throw new LucentError("CODE")` arrives in
  JS as an `Error` with `code`; `Uint8Array` crosses as an `ArrayBuffer`.
- **Your host, your choice.** The same module compiles for Expo Modules
  (SDK 58, Swift macros on iOS) or Nitro Modules (bare React Native, zero-copy
  buffers). Switching is a config flag.

## How it works

```
*.lucent.ts ──► compiler ──► typed IR ──► Swift ─┐
                                      └─► Kotlin ─┤──► Expo Module  ─┐
                                                  └──► Nitro Hybrid ─┤──► JS proxy ──► your app
```

1. The compiler parses the file with [oxc](https://oxc.rs), checks it against the
   Lucent subset, and lowers it to a small typed IR.
2. Backends emit Swift and Kotlin bodies from the IR.
3. A host wraps those bodies as an Expo Module or a Nitro HybridObject and
   generates the JavaScript proxy that replaces the file in your bundle.
4. A Metro transformer swaps `*.lucent.ts` for the proxy at bundle time, and an
   Expo config plugin (or the CLI) writes the native package during prebuild.

The compiler never sees Expo or Nitro, and the backends never see TypeScript.
[docs/language.md](docs/language.md) is the language contract;
[docs/ir.md](docs/ir.md) describes the IR.

## Getting started

### Expo

```sh
npx expo install @lucent-lang/runtime @lucent-lang/types @lucent-lang/expo @lucent-lang/metro
```

```js
// metro.config.js
const { getDefaultConfig } = require("expo/metro-config");
const { withLucent } = require("@lucent-lang/metro");

module.exports = withLucent(getDefaultConfig(__dirname), { host: "expo" });
```

```json
// app.json
{ "expo": { "plugins": [["@lucent-lang/expo", { "host": "expo" }]] } }
```

Write a `*.lucent.ts` file anywhere in your project, import it, and run
`npx expo prebuild && npx expo run:ios` (or `run:android`). The plugin compiles
your modules into `modules/lucent/`, which Expo autolinks. Expo Go is not
supported; a development build is required, as for any native module.

### Bare React Native (Nitro)

```sh
npm install @lucent-lang/runtime react-native-nitro-modules
npm install -D @lucent-lang/types @lucent-lang/metro @lucent-lang/cli nitrogen
```

```js
// metro.config.js
const { getDefaultConfig, mergeConfig } = require("@react-native/metro-config");
const { withLucent } = require("@lucent-lang/metro");

module.exports = withLucent(mergeConfig(getDefaultConfig(__dirname), {}), { host: "nitro" });
```

```js
// react-native.config.js
const path = require("path");
module.exports = {
  dependencies: { "lucent-native": { root: path.join(__dirname, ".lucent", "nitro") } },
};
```

Run `npx lucent build --host nitro` whenever your `*.lucent.ts` files change
(it runs `nitrogen` for you), then `pod install` and build as usual.

### CLI

```
lucent build [--host expo|nitro] [--emit-ir] [--force] [files…]   compile and emit the native package
lucent check [files…]                                             type-check only
lucent init [--host expo|nitro]                                   wire a project's package.json
```

Builds are incremental: unchanged modules are served from `.lucent/cache.json`.

## The language

Lucent is TypeScript with a fence around it. Inside the fence:

| You write                                         | Native side                                     |
| ------------------------------------------------- | ----------------------------------------------- |
| `number`, `string`, `boolean`                     | `Double`, `String`, `Bool`/`Boolean`            |
| `int32`, `float32`, … (from `@lucent-lang/types`) | sized numerics                                  |
| `T[]`, `Record<string, T>`                        | arrays, maps                                    |
| `T \| null`, `field?: T`                          | optionals, with narrowing via `if (x === null)` |
| `type User = { … }`                               | Swift `struct`, Kotlin `data class`             |
| `Uint8Array`                                      | `ArrayBuffer`                                   |
| `async` / `Promise<T>`                            | `async throws` / `suspend`                      |
| `throw new LucentError(code, { message })`        | an `Error` with `code` in JS                    |

Functions, `if`/`while`/`for`/`for…of`, arithmetic, comparisons, template
strings, array `push`/index/`length`, calls between functions in the same file.
Everything else is a diagnostic with a code, a codeframe and a suggestion:

```
error NT1004: `any` is prohibited

Native functions cannot expose `any`.

  ┌─ any.lucent.ts:1:28
1 │ export function foo(value: any): number {
  │                            ^^^

Lucent needs to know the exact memory representation of every value crossing
the native boundary. Use a concrete type such as `string`, `number`, or a
struct type alias.
```

The full contract, including every diagnostic code, is in
[docs/language.md](docs/language.md).

## Status

Verified end to end on the iOS simulator and the Android emulator, for both
hosts, with the example apps in [apps/](apps/): sync and async calls, recursion,
structs with optionals, template strings, bytes, and error codes and messages.

Not in v1 yet: discriminated unions, native classes, events, native views,
thread annotations, platform SDK bindings. The order we plan to take them in is
in [ROADMAP.md](ROADMAP.md).

## Repository

```
packages/
  compiler/        parser, checker, IR, lowering, diagnostics
  backend-swift/   IR → Swift
  backend-kotlin/  IR → Kotlin
  host-core/       host contract, .d.ts generation, JS boundary conversions
  host-expo/       Expo Modules (SDK 58) host
  host-nitro/      Nitro Modules host
  runtime/         @lucent-lang/runtime — what generated proxies import
  types/           @lucent-lang/types — sized numerics and the LucentError declaration
  metro/           withLucent() Metro transformer
  expo/            Expo config plugin
  cli/             lucent build / check / init
apps/
  expo-example/    Expo SDK 58 app exercising every feature
  bare-example/    bare React Native + Nitro app, same checks
fixtures/          the programs every layer is tested against, with golden outputs
docs/              language and IR contracts
```

Dependencies flow one way: `cli / expo / metro → host → backend → compiler`.

### Developing

Requires Node 22.12+, pnpm 12, and for native verification Xcode with `swiftc`
and `kotlinc` (`brew install kotlin`).

```sh
pnpm install
pnpm test           # vitest via Vite+
pnpm typecheck
pnpm verify         # + lint, format check, and compiling every fixture with swiftc and kotlinc
pnpm build:packages # bundle the Node-loaded entries (Metro transformer, Expo plugin, CLI)
```

Fixtures in `fixtures/` are the shared contract: each `*.lucent.ts` has golden
IR, Swift, Kotlin, Expo and Nitro outputs. Tests are committed before the code
that makes them pass. See [AGENTS.md](AGENTS.md) for the working rules.

## License

[MIT](LICENSE)
