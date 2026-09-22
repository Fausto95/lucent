import type { DocPage } from "../types";

const MODULE =
  "export type Point = { x: number; y: number };\n\nexport function squaredDistance(a: Point, b: Point): number {\n  const dx = a.x - b.x;\n  const dy = a.y - b.y;\n  return dx * dx + dy * dy;\n}";

const USE =
  'import { squaredDistance } from "./src/geo.lucent";\n\nsquaredDistance({ x: 0, y: 0 }, { x: 3, y: 4 }); // 25';

export const page: DocPage = {
  slug: "getting-started",
  title: "Getting started",
  description:
    "Add Lucent to an Expo app or a bare React Native app, write one `*.lucent.ts` file, and run it on a device.",
  blocks: [
    {
      kind: "note",
      text: "Lucent generates native code, so it needs a development build. Expo Go cannot load it, the same as any other native module. Node 22.12+ is required.",
    },
    {
      kind: "code",
      filename: "terminal",
      code: "npx @lucent-lang/cli init      # detects Expo or bare React Native and wires the app\nnpx @lucent-lang/cli doctor    # verifies the toolchain and the wiring",
    },
    {
      kind: "p",
      text: "`init` adds the dependencies, `lucent.config.ts`, a Metro config, the Expo plugin or the Nitro autolink entry, and a starter module. The steps below show what it produces, for wiring things by hand. The [CLI reference](/docs/api/cli/) covers every command.",
    },
    { kind: "h2", text: "Expo" },
    {
      kind: "p",
      text: "The config plugin compiles your modules during `expo prebuild` into an autolinked Expo Module. The Metro plugin swaps each Lucent file for its JavaScript proxy at bundle time.",
    },
    {
      kind: "steps",
      steps: [
        {
          title: "Install",
          blocks: [
            {
              kind: "code",
              filename: "terminal",
              code: "npx expo install @lucent-lang/core",
            },
          ],
        },
        {
          title: "Configure Metro",
          blocks: [
            {
              kind: "code",
              filename: "metro.config.js",
              code: 'const { getDefaultConfig } = require("expo/metro-config");\nconst { withLucent } = require("@lucent-lang/core/metro");\n\nmodule.exports = withLucent(getDefaultConfig(__dirname), { host: "expo" });',
            },
          ],
        },
        {
          title: "Add the config plugin",
          blocks: [
            {
              kind: "code",
              filename: "app.json",
              code: '{\n  "expo": {\n    "plugins": [["@lucent-lang/core/expo", { "host": "expo" }]]\n  }\n}',
            },
          ],
        },
        {
          title: "Write a module",
          blocks: [{ kind: "code", filename: "src/geo.lucent.ts", code: MODULE }],
        },
        {
          title: "Use it",
          blocks: [{ kind: "code", filename: "App.tsx", code: USE }],
        },
        {
          title: "Build and run",
          blocks: [
            { kind: "code", filename: "terminal", code: "npx expo prebuild\nnpx expo run:ios   # or run:android" },
            {
              kind: "p",
              text: "Generated code lands in `modules/lucent/`, which Expo autolinks. Unchanged modules are cached between builds.",
            },
          ],
        },
      ],
    },
    { kind: "h2", text: "Bare React Native" },
    {
      kind: "p",
      text: "Without Expo, Lucent targets [Nitro Modules](https://nitro.margelo.com/). The CLI generates a local library under `.lucent/nitro/`, runs nitrogen, and React Native autolinks it.",
    },
    {
      kind: "steps",
      steps: [
        {
          title: "Install",
          blocks: [
            {
              kind: "code",
              filename: "terminal",
              code: "npm install @lucent-lang/core react-native-nitro-modules\nnpm install -D @lucent-lang/cli nitrogen",
            },
          ],
        },
        {
          title: "Configure Metro",
          blocks: [
            {
              kind: "code",
              filename: "metro.config.js",
              code: 'const { getDefaultConfig, mergeConfig } = require("@react-native/metro-config");\nconst { withLucent } = require("@lucent-lang/core/metro");\n\nmodule.exports = withLucent(mergeConfig(getDefaultConfig(__dirname), {}), { host: "nitro" });',
            },
          ],
        },
        {
          title: "Register the generated library",
          blocks: [
            {
              kind: "code",
              filename: "react-native.config.js",
              code: 'const path = require("path");\n\nmodule.exports = {\n  dependencies: {\n    "lucent-native": { root: path.join(__dirname, ".lucent", "nitro") },\n  },\n};',
            },
            {
              kind: "p",
              text: "Linking by path instead of a `file:` dependency means regenerated output is picked up without reinstalling.",
            },
          ],
        },
        {
          title: "Write a module",
          blocks: [{ kind: "code", filename: "src/geo.lucent.ts", code: MODULE }],
        },
        {
          title: "Build and run",
          blocks: [
            {
              kind: "code",
              filename: "terminal",
              code: "npx lucent build --host nitro\ncd ios && pod install && cd ..\nnpx react-native run-ios   # or run-android",
            },
            {
              kind: "p",
              text: "Run `npx lucent build --host nitro` again whenever a Lucent file changes. Nitro views require the new architecture.",
            },
          ],
        },
      ],
    },
    { kind: "h2", text: "Beyond functions" },
    {
      kind: "p",
      text: "All authoring subpaths below are included in @lucent-lang/core; no additional Lucent packages need to be installed.",
    },
    {
      kind: "table",
      head: ["Package", "Gives you"],
      rows: [
        ["`@lucent-lang/core/objects`", "`SharedObject` base for [native classes](/docs/language/native-classes/)"],
        ["`@lucent-lang/core/events`", "`event<T>()` and `Event<T>` for [events](/docs/language/events/) and view callbacks"],
        ["`@lucent-lang/core/ui`", "`VStack`, `Text`, `Button`, `TextField`… for [native views](/docs/language/native-views/)"],
        ["`@lucent-lang/core`, `@lucent-lang/core/platform`", "the [built-in library](/docs/api/std/)"],
        ["`@lucent-lang/core/config`", "`defineNativeConfig` for [capabilities and libraries](/docs/api/config/)"],
      ],
    },
    {
      kind: "p",
      text: "Capabilities such as `filesystem` or `network` are a build-time allowlist. Declare them once per app:",
    },
    {
      kind: "code",
      filename: "lucent.config.ts",
      code: 'import { defineNativeConfig } from "@lucent-lang/core/config";\n\nexport default defineNativeConfig({\n  capabilities: { filesystem: true, network: true, crypto: true },\n});',
    },
    { kind: "h2", text: "Development loop" },
    {
      kind: "list",
      items: [
        "Changing a `.lucent.ts(x)` file changes native code. Rebuild the app (`expo run:ios` or `lucent build` + Xcode/Gradle). There is no native hot reload.",
        "Generated Swift and Kotlin are overwritten on the next build. Do not edit `modules/lucent/` or `.lucent/nitro/`. There are no source maps; a native crash is a native stack trace.",
        "Changing React code that calls into Lucent works as usual with Fast Refresh.",
        "Run `lucent check` for diagnostics without generating anything. Metro reports the same errors with a code frame when it bundles.",
        "When files are added to the generated package, refresh CocoaPods or Gradle (`pod install`, Gradle sync).",
      ],
    },
    {
      kind: "cards",
      items: [
        { title: "How it works", text: "What the build actually produces and where it runs.", href: "/docs/how-it-works/" },
        { title: "Examples", text: "Annotated modules and views from the example apps.", href: "/docs/examples/" },
      ],
    },
  ],
};
