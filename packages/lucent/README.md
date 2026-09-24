# @lucent-lang/lucent

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
    return main(
      () =>
        appContext()
          .getSystemService(ClipboardManager)
          ?.getPrimaryClipDescription()
          ?.hasMimeType(ClipDescription.MIMETYPE_TEXT_PLAIN) ?? false,
    );
  }
}
```

## Install

You need React Native 0.88 or later, or Expo SDK 58 in a development build,
and Node 22.12 or later.

```sh
npm i -D @lucent-lang/lucent
npx lucent init
```

`lucent init` sets the app up (the Metro config, the Expo plugin or the
Gradle task, `tsconfig.json`, `.gitignore`, a first module), showing each
change as a diff and asking before applying it. Lucent adds native code, so
an Expo app runs as a development build (`npx expo run:ios`,
`npx expo run:android`), not in Expo Go.

`npx lucent doctor` checks your machine: Xcode, the Android SDK and NDK, the
JDK, and the app's setup.

## What's in the package

- The `lucent` CLI: `init`, `build`, `check`, `dev`, `doctor`, `sdk` and
  more (`npx lucent --help`).
- The compiler, which Metro runs on `*.lucent.ts` files through
  `@lucent-lang/lucent/metro`.
- The Expo config plugin (`@lucent-lang/lucent` in `app.json`'s plugins).
- An editor plugin that shows Lucent's diagnostics in TypeScript-aware
  editors (`@lucent-lang/lucent/ts-plugin`).
- `@lucent-lang/lucent/core`: the JavaScript version of `lucent:core`, for
  tests that run Lucent modules as plain TypeScript.

## Docs

[What is Lucent](https://lucent-lang.dev/docs/) ·
[Install](https://lucent-lang.dev/docs/install/) ·
[Tutorial](https://lucent-lang.dev/docs/tutorial/1-shared-logic/) ·
[How it works](https://lucent-lang.dev/docs/how-it-works/) ·
[Guides](https://lucent-lang.dev/docs/guides/call-an-ios-api/) ·
[Reference](https://lucent-lang.dev/docs/reference/language/) ·
[Examples](https://lucent-lang.dev/docs/examples/) ·
[Changelog](https://github.com/Fausto95/lucent/blob/main/packages/lucent/CHANGELOG.md)

Issues and source: [github.com/Fausto95/lucent](https://github.com/Fausto95/lucent).

MIT
