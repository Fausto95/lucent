<p align="center">
  <img src="assets/logo.svg" width="96" alt="Lucent">
</p>

<h1 align="center">Lucent</h1>

> [!WARNING]
> **Experimental: not for production.** APIs and the language subset change
> without a migration path.

Write React Native native modules in TypeScript. Lucent compiles a checked
subset to C++ and calls it through JSI: no Swift or Kotlin to write, and no
JavaScript engine in native code.

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

A module also calls the iOS and Android SDKs directly, typed from your Xcode
and Android SDK. One module holds both platforms:

```ts
// src/clipboard.lucent.ts
import { PLATFORM } from "lucent:platform";
import { UIPasteboard } from "lucent:ios/UIKit";
import { ClipboardManager, ClipDescription } from "lucent:android/android.content";
import { appContext } from "lucent:android";
import { main } from "lucent:thread";

export async function hasStringAsync(): Promise<boolean> {
  if (PLATFORM === "ios") {
    return UIPasteboard.general.hasStrings;
  } else {
    return main(() => appContext().getSystemService(ClipboardManager)?.getPrimaryClipDescription()?.hasMimeType(ClipDescription.MIMETYPE_TEXT_PLAIN) ?? false);
  }
}
```

Works in bare React Native (0.88+) and Expo (SDK 58+, development builds).

## Install

```sh
npm i -D @lucent-lang/lucent
npx lucent init
```

<p align="center">
  <img src="assets/cli.svg" width="560" alt="lucent build, then lucent check reporting an error with a code frame and its fix">
</p>

`@lucent-lang/lucent` isn't on npm yet: until it is, install the tarball that
`pnpm pack` writes in `packages/lucent`.

## Docs

[What is Lucent](https://lucent-lang.dev/docs/) ·
[Install](https://lucent-lang.dev/docs/install/) ·
[Tutorial](https://lucent-lang.dev/docs/tutorial/1-shared-logic/) ·
[How it works](https://lucent-lang.dev/docs/how-it-works/) ·
[Guides](https://lucent-lang.dev/docs/guides/call-an-ios-api/) ·
[Reference](https://lucent-lang.dev/docs/reference/language/) ·
[Examples](https://lucent-lang.dev/docs/examples/) ·
[Roadmap](ROADMAP.md)

## Develop

```sh
pnpm install
pnpm test                      # compiler and CLI tests
pnpm test:runtime              # C++ runtime tests
pnpm test:e2e                  # compiled modules against the same code as JavaScript (needs Hermes)
pnpm exec tsx scripts/website.ts   # the website's generated files, samples, links and prose
```

[CONTRIBUTING.md](CONTRIBUTING.md) covers the setup, every suite and the
commit style; [docs/](docs/) holds the architecture and the specs.

MIT © Lucent
