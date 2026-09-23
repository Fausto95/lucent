# Lucent

**Write React Native native modules in TypeScript. Lucent compiles them to C++ and exposes them over JSI.**

```ts
// src/hash.lucent.ts
export function hash(input: string, seed: number = 0): number {
  let h = seed | 0;
  for (let i = 0; i < input.length; i++) {
    h = Math.imul(h ^ input.charCodeAt(i), 0x5bd1e995);
    h ^= h >>> 15;
  }
  return h >>> 0;
}

export async function hashMany(inputs: string[]): Promise<number[]> {
  return inputs.map((s) => hash(s)); // runs off the JS thread
}
```

```tsx
// App.tsx
import { hash, hashMany } from "./src/hash.lucent";

hash("hello");                 // synchronous call into C++
await hashMany(["a", "b"]);    // async: runs on the Lucent thread, resolves on the JS thread
```

There is no JavaScript engine on the native side, and no Swift, Kotlin, Nitro or
Expo Modules layer. Each `*.lucent.ts` file becomes C++ that talks to Hermes
through JSI, through one pure C++ TurboModule that React Native autolinks on
both platforms.

> **Status: experimental.** This branch (`cpp-jsi`) is a from-scratch rewrite.
> See [ROADMAP.md](ROADMAP.md) and [TODO.md](TODO.md).

## How it works

```
*.lucent.ts ──TypeScript checker──▶ typed lowering ──▶ C++ (lucent_app.h, m_*.cpp)
                                                          │
                     lucent runtime (strings, numbers, arrays, maps, promises,
                     errors, scheduler) + JSI bindings + TurboModule "Lucent"
                                                          │
                          .lucent/native  ◀── autolinked by React Native (iOS pod, Android CMake)
```

* The **compiler** uses the real TypeScript type checker, including its narrowing,
  then lowers the program to C++ with JavaScript semantics: doubles with ECMAScript
  arithmetic, UTF-16 strings, arrays and objects as shared references, exceptions,
  and `async`/`await` on C++20 coroutines.
* The **runtime** (`packages/runtime/cpp/lucent`) implements those semantics, plus
  the JSI boundary: argument validation with readable errors, class instances
  with stable identity, JS callbacks, and promises in both directions.
* **Metro** swaps each `*.lucent.ts` import for a small generated proxy. Your editor
  still type-checks against the original source.

Read [docs/architecture.md](docs/architecture.md) for the details and
[docs/language.md](docs/language.md) for what the language supports.

## Using it in an app

```sh
npm i @lucent-lang/runtime @lucent-lang/core
npm i -D @lucent-lang/cli @lucent-lang/metro
npx lucent init        # react-native.config.js entry + .gitignore
```

```js
// metro.config.js
const { withLucent } = require("@lucent-lang/metro");
module.exports = withLucent(getDefaultConfig(__dirname));
```

Then, whenever native code changes:

```sh
npx lucent build          # writes .lucent/native (C++ + build files); instant when nothing changed
cd ios && pod install     # iOS, when files were added or removed
npx react-native run-ios  # or run-android
```

While Metro's dev server runs, `withLucent` keeps `.lucent/native` up to date
as you edit (`lucent build --watch` does the same on its own); rebuild the app
to run changed native code. Each module has its own generated header, so Xcode
and Gradle recompile only the modules that changed and their importers.

**Expo:** add `"@lucent-lang/expo"` to `plugins` in `app.json`. `expo prebuild`
runs `lucent build` and links the package.

## Repository

| Path | What |
|---|---|
| `packages/compiler` | TypeScript → C++ compiler, native package writer |
| `packages/runtime` | C++ runtime (`cpp/lucent`), TurboModule host (`cpp/rn`), iOS/Android build templates (`native/`), JS loader (`js/`) |
| `packages/cli` | `lucent build`, `lucent check`, `lucent init` |
| `packages/metro` | Metro transformer that swaps `*.lucent.ts` for proxies |
| `packages/expo` | Expo config plugin |
| `packages/core` | `@lucent-lang/core`: `delay`, `error`, `utf8Encode`… (native + JS implementations) |
| `apps/bare-example`, `apps/expo-example` | Example apps with an on-device test screen |
| `scripts/` | `sync-examples.ts` (copies the e2e cases into the apps), `app-check.ts` (headless app pipeline check) |

## Tests

```sh
pnpm install
packages/runtime/test/run.sh                          # C++ runtime unit tests (SANITIZE=1 for ASan/UBSan)
HERMES_DIR=~/hermes npx tsx packages/compiler/test/e2e/run.ts   # compile → C++ → Hermes, diffed against plain JS
HERMES_DIR=~/hermes npx tsx scripts/app-check.ts apps/bare-example  # the app's real Metro bundle + generated C++, headless
```

The end-to-end tests need a Hermes build (`cmake -S hermes -B hermes/build -G Ninja && ninja -C hermes/build hermesvm`):
every case runs natively through real JSI and must print exactly what the same
TypeScript prints when run as JavaScript in Node.

## License

MIT
