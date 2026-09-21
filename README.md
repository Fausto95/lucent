<p align="center">
  <img src="assets/logo.svg" width="96" alt="Lucent">
</p>

<h1 align="center">Lucent</h1>

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

export async function sum(values: number[]): Promise<number> {
  let total = 0;
  for (const v of values) total += v;
  return total;
}
```

```ts
import { squaredDistance, sum } from "./src/geo.lucent";

squaredDistance({ x: 0, y: 0 }, { x: 3, y: 4 }); // 25, runs in Swift / Kotlin
await sum([1, 2, 3]); // native async function
```

Works with [Expo Modules](https://docs.expo.dev/modules/overview/) (SDK 58)
and [Nitro Modules](https://nitro.margelo.com/) (bare React Native).

> Pre-release. The language is intentionally small and the API will change.

## Setup

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

Then `npx expo prebuild` and `npx expo run:ios` or `run:android`. Requires a
development build, not Expo Go.

### Bare React Native

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

Run `npx lucent build --host nitro` after changing a `*.lucent.ts` file, then
`pod install` and build as usual.

## What you can write

| TypeScript                                      | Native                     |
| ----------------------------------------------- | -------------------------- |
| `number`, `string`, `boolean`                   | `Double`, `String`, `Bool` |
| `int32`, `float32`, … from `@lucent-lang/types` | sized numerics             |
| `T[]`, `Record<string, T>`                      | arrays, maps               |
| `T \| null`, `field?: T`                        | optionals                  |
| `type User = { … }`                             | `struct` / `data class`    |
| `Uint8Array`                                    | `ArrayBuffer`              |
| `async` / `Promise<T>`                          | `async throws` / `suspend` |
| `throw new LucentError("CODE")`                 | `Error` with `code` in JS  |

Plus functions, `if`, `while`, `for`, `for…of`, arithmetic, comparisons,
template strings, and array `push`, index, `length`. Anything else is a compile
error with a clear message:

```
error NT1004: `any` is prohibited

  ┌─ any.lucent.ts:1:28
1 │ export function foo(value: any): number {
  │                            ^^^

Use a concrete type such as `string`, `number`, or a struct type alias.
```

Full details: [docs/language.md](docs/language.md).

## How it works

```
*.lucent.ts → compiler → Swift + Kotlin → Expo Module or Nitro HybridObject → JS proxy
```

The Metro transformer replaces each `*.lucent.ts` with a generated proxy at
bundle time. The Expo plugin (or `lucent build`) writes the native code during
prebuild. Design notes: [docs/ir.md](docs/ir.md).

## Status

Verified on iOS and Android, on both hosts: sync and async calls, structs,
optionals, bytes, errors. Not yet: unions, native classes, events, views.
See [ROADMAP.md](ROADMAP.md).

## Contributing

Node 22.12+, pnpm 12. For native checks: Xcode and `brew install kotlin`.

```sh
pnpm install
pnpm test
pnpm verify   # typecheck, lint, format, tests, and compile fixtures with swiftc/kotlinc
```

Layout: `packages/` (compiler, backends, hosts, metro, expo, cli, runtime,
types), `apps/` (example apps), `fixtures/` (golden tests), `docs/`.

MIT © Faustino Kialungila
