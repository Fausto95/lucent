import type { Block } from "../types";

export const blocks: Block[] = [
    {
      kind: "p",
      text: "Lucent adds native code to your app, so it needs a [development build](https://docs.expo.dev/develop/development-builds/introduction/). It does not run in Expo Go. The repository's `apps/expo-example` is a complete, working version of this setup. For a bare React Native app, see [Getting started (bare React Native)](/docs/getting-started/).",
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
              code: `npm i -D @lucent-lang/lucent
npx lucent init`,
            },
            {
              kind: "p",
              text: "One package holds the `lucent` command, the compiler, the Metro integration and the Expo config plugin. It has no runtime code and does not use Expo Modules. `lucent init` adds `.lucent/` to `.gitignore` and maps `lucent:*` imports in `tsconfig.json`.",
            },
          ],
        },
        {
          title: "Add the config plugin",
          blocks: [
            {
              kind: "code",
              filename: "app.json",
              code: `{
  "expo": {
    "plugins": ["@lucent-lang/lucent"]
  }
}`,
            },
            {
              kind: "p",
              text: "During `expo prebuild`, the plugin runs `lucent build` and makes sure `react-native.config.js` has the `lucent` entry that links `.lucent/native`. It creates the file if it is missing, and stops prebuild with the entry to add if the file exists without it. See the [Expo reference](/docs/reference/expo/).",
            },
          ],
        },
        {
          title: "Wrap the Metro config",
          blocks: [
            {
              kind: "code",
              filename: "metro.config.js",
              code: `const { getDefaultConfig } = require("expo/metro-config");
const { withLucent } = require("@lucent-lang/lucent/metro");

module.exports = withLucent(getDefaultConfig(__dirname));`,
            },
            {
              kind: "p",
              text: "Enable `noUncheckedIndexedAccess` in `tsconfig.json`, which Lucent requires.",
            },
          ],
        },
        {
          title: "Write a module",
          blocks: [
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
          title: "Prebuild and run",
          blocks: [
            {
              kind: "code",
              filename: "terminal",
              code: `npx expo prebuild
npx expo run:ios              # or: npx expo run:android`,
            },
            {
              kind: "p",
              text: "`expo prebuild` compiles your modules before CocoaPods and Gradle run, so the native package is linked like any other dependency. If a module does not compile, prebuild fails with the diagnostics.",
            },
          ],
        },
      ],
    },
    { kind: "h2", text: "The dev loop" },
    {
      kind: "list",
      items: [
        "While `expo start` or `expo run:ios`/`run:android` serves the bundle, `withLucent` keeps `.lucent/native` up to date as you edit.",
        "Changed native code runs after you rebuild the app with `npx expo run:ios` or `npx expo run:android`. Reloading the JavaScript does not replace the C++ in the installed binary.",
        "When you add or remove a module, run `npx expo prebuild` again (or `pod install` in `ios/`) before the next iOS build.",
        "`npx lucent check` validates every module without writing anything.",
      ],
    },
    {
      kind: "p",
      text: "The dev loop is the same as in a bare app; [Getting started (bare React Native)](/docs/getting-started/#the-dev-loop) covers it in more detail, and also shows how to set up editor diagnostics.",
    },
];
