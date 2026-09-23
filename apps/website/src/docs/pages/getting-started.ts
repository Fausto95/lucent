import type { DocPage } from "../types";

export const page: DocPage = {
  slug: "getting-started",
  title: "Getting started (bare React Native)",
  description: "Add Lucent to a bare React Native 0.88 app, compile a module and call it from JavaScript.",
  blocks: [
    {
      kind: "p",
      text: "This page wires Lucent into an existing React Native app (0.88, New Architecture). Using Expo? Follow [Getting started (Expo)](/docs/getting-started-expo/) instead. The repository's `apps/bare-example` is a complete, working version of this setup.",
    },
    {
      kind: "note",
      tone: "warn",
      text: "`@lucent-lang/lucent` is **not published to npm yet**. Until it is, build its tarball from the repository with `pnpm pack` in `packages/lucent`, then install the tarball.",
    },
    {
      kind: "steps",
      steps: [
        {
          title: "Install Lucent",
          blocks: [
            {
              kind: "code",
              filename: "terminal",
              code: "npm i -D @lucent-lang/lucent",
            },
            {
              kind: "p",
              text: "One package holds everything: the `lucent` command, the compiler, the C++ runtime, the Metro integration and the editor plugin. It is build-time only. `lucent build` writes into your app what the app needs at run time, the native package and the JS loader its modules use. Helpers such as `delay` are built in as [`lucent:core`](/docs/reference/core/).",
            },
          ],
        },
        {
          title: "Run `lucent init`",
          blocks: [
            { kind: "code", filename: "terminal", code: "npx lucent init" },
            {
              kind: "p",
              text: "It adds a `lucent` entry to `react-native.config.js`, so autolinking picks up the generated native package in `.lucent/native`, adds `.lucent/` to `.gitignore`, and maps `lucent:*` imports in `tsconfig.json` to the declarations `lucent build` writes. If `react-native.config.js` already exists, it prints the entry for you to add:",
            },
            {
              kind: "code",
              filename: "react-native.config.js",
              code: `const path = require("path");

module.exports = {
  dependencies: {
    lucent: {
      root: path.join(__dirname, ".lucent", "native"),
    },
  },
};`,
            },
            {
              kind: "p",
              text: "Lucent checks modules with `noUncheckedIndexedAccess`. Enable it in `tsconfig.json` too, so your editor agrees with the compiler (see [editor diagnostics](#editor-diagnostics) below).",
            },
          ],
        },
        {
          title: "Wrap the Metro config",
          blocks: [
            {
              kind: "code",
              filename: "metro.config.js",
              code: `const { getDefaultConfig, mergeConfig } = require("@react-native/metro-config");
const { withLucent } = require("@lucent-lang/lucent/metro");

module.exports = withLucent(mergeConfig(getDefaultConfig(__dirname), {}));`,
            },
            {
              kind: "p",
              text: "`withLucent` makes Metro bundle a generated proxy in place of each `*.lucent.ts` file, and keeps the native package current while the dev server runs. Options are in the [Metro reference](/docs/reference/metro/).",
            },
          ],
        },
        {
          title: "Write a module",
          blocks: [
            {
              kind: "p",
              text: "Any file named `*.lucent.ts` in the project is a Lucent module (`node_modules`, `ios`, `android` and dot-directories are skipped).",
            },
            {
              kind: "code",
              filename: "geo.lucent.ts",
              code: `export type Point = { x: number; y: number };

export function squaredDistance(a: Point, b: Point): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return dx * dx + dy * dy;
}`,
            },
            {
              kind: "code",
              filename: "App.tsx",
              code: `import { Text } from "react-native";
import { squaredDistance } from "./src/geo.lucent";

export default function App() {
  return <Text>{squaredDistance({ x: 0, y: 0 }, { x: 3, y: 4 })}</Text>;
}`,
            },
          ],
        },
        {
          title: "Build the native package",
          blocks: [
            { kind: "code", filename: "terminal", code: "npx lucent build" },
            {
              kind: "p",
              text: "This compiles every module and writes `.lucent/native`: the C++ runtime, the generated C++, the podspec and CMake files, and the JS proxies. Type errors and unsupported code stop the build with a `LUCENT` diagnostic, and nothing is written. When nothing changed since the last build, it returns immediately.",
            },
          ],
        },
        {
          title: "Install pods and run",
          blocks: [
            {
              kind: "code",
              filename: "terminal",
              code: `cd ios && pod install && cd ..
npx react-native run-ios      # or: npx react-native run-android`,
            },
            {
              kind: "p",
              text: "Android needs no extra step: Gradle adds the package's CMake project to the app's native build. The screen shows `25`, computed in C++.",
            },
          ],
        },
      ],
    },
    { kind: "h2", text: "The dev loop" },
    {
      kind: "list",
      items: [
        "While Metro's dev server runs (`react-native start`, or the one `run-ios`/`run-android` starts), `withLucent` runs `lucent build --watch`, so `.lucent/native` follows your edits. Outside Metro, run `npx lucent build --watch` yourself.",
        "Changed native code only runs after you **rebuild the app** (Xcode or Gradle); reloading the JavaScript does not replace the C++ in the running binary. Each module has its own header, so the native build recompiles only the modules that changed and the modules that import them.",
        "When modules are added or removed, run `pod install` again before the iOS build; `lucent build` tells you when.",
        "`npx lucent check` type-checks and validates every module without writing anything. Use it in CI.",
      ],
    },
    {
      kind: "p",
      text: "If the app throws `geo.lucent.ts has not been compiled`, Metro found no proxy for the module: run `npx lucent build`, then rebuild the app.",
    },
    { kind: "h2", text: "Editor diagnostics" },
    {
      kind: "p",
      text: "TypeScript itself accepts code that Lucent rejects (`var`, `any`, and so on). To see Lucent's diagnostics as you type, add the plugin `@lucent-lang/lucent` ships to `tsconfig.json`. In VS Code, select the workspace TypeScript version so the plugin loads.",
    },
    {
      kind: "code",
      filename: "tsconfig.json",
      code: `{
  "compilerOptions": {
    "noUncheckedIndexedAccess": true,
    "plugins": [{ "name": "@lucent-lang/lucent/ts-plugin" }]
  }
}`,
    },
    { kind: "h2", text: "Next" },
    {
      kind: "p",
      text: "Read [how it works](/docs/how-it-works/), then [the language](/docs/language/) and [how values cross the boundary](/docs/boundary/exports/). All commands and flags are in the [CLI reference](/docs/reference/cli/).",
    },
  ],
};
