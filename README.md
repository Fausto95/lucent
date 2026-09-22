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

## Releasing

Run the **Release** workflow from `main` (Actions → Release → Run workflow) and
pick `patch`, `minor` or `major`. It bumps the root `package.json` and every
`packages/*` in lockstep, runs the CI gate, commits `chore(release): vX.Y.Z`,
tags it, publishes all `@lucent-lang/*` packages to npm and creates a GitHub
Release with generated notes. Publishing needs an `NPM_TOKEN` repository secret
(granular npm token with write access to the `@lucent-lang` scope, 2FA bypass).

MIT © Faustino Kialungila
