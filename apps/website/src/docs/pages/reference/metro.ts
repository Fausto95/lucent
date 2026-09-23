import type { DocPage } from "../../types";

export const page: DocPage = {
  slug: "reference/metro",
  title: "Metro",
  description: "`withLucent` from @lucent-lang/metro: bundles each `*.lucent.ts` import as its native proxy and rebuilds while the dev server runs.",
  blocks: [
    {
      kind: "p",
      text: "Metro must know that a `*.lucent.ts` file is not JavaScript to bundle. Wrap your Metro config with `withLucent`:",
    },
    {
      kind: "tabs",
      tabs: [
        {
          label: "React Native CLI",
          filename: "metro.config.js",
          code: `const { getDefaultConfig, mergeConfig } = require("@react-native/metro-config");
const { withLucent } = require("@lucent-lang/metro");

module.exports = withLucent(mergeConfig(getDefaultConfig(__dirname), {}));`,
        },
        {
          label: "Expo",
          filename: "metro.config.js",
          code: `const { getDefaultConfig } = require("expo/metro-config");
const { withLucent } = require("@lucent-lang/metro");

module.exports = withLucent(getDefaultConfig(__dirname));`,
        },
      ],
    },
    {
      kind: "code",
      filename: "index.d.ts",
      code: `function withLucent<T extends object>(config: T, options?: { watch?: boolean }): T;`,
    },
    { kind: "h2", text: "What it does" },
    {
      kind: "h3",
      text: "Swaps sources for proxies",
    },
    {
      kind: "p",
      text: "`withLucent` installs a Babel transformer in front of Metro's own. When Metro transforms a `*.lucent.ts` file, it bundles the generated proxy from `.lucent/native/js/<module>.js` instead of the file's contents, so `import { clamp } from \"./counter.lucent\"` calls the native module. Every other file goes to the upstream transformer unchanged. See [Exports & proxies](/docs/boundary/exports/) for what the proxy contains.",
    },
    {
      kind: "list",
      items: [
        "The upstream transformer is your config's `transformer.babelTransformerPath` if set, otherwise `@react-native/metro-babel-transformer` or `@expo/metro-config/babel-transformer`, whichever the project has.",
        "Metro's cache key includes the build manifest, so a new `lucent build` invalidates cached proxies.",
        "If a module has not been compiled yet, the bundle still builds, and importing the module throws an error that tells you to run `lucent build`.",
      ],
    },
    { kind: "h3", text: "Rebuilds while you edit" },
    {
      kind: "p",
      text: "When Metro runs as a dev server (`react-native start`, `expo start`, `expo run:ios`, `expo run:android`), `withLucent` starts `lucent build --watch` for the project root, in the same terminal. Saving a `*.lucent.ts` file recompiles it; diagnostics are printed next to Metro's output.",
    },
    {
      kind: "code",
      filename: "terminal",
      code: `Lucent: watching /path/to/app for *.lucent.ts changes
[10:42:01] ✓ Lucent: 3 module(s), 2 file(s) written
  Native code changed: rebuild the app (Xcode / Gradle) to run it.`,
    },
    {
      kind: "p",
      text: "The watcher needs `@lucent-lang/cli` installed; without it, Metro prints a warning and you run `lucent build` yourself. It stops when Metro exits.",
    },
    { kind: "h2", text: "Options" },
    {
      kind: "table",
      head: ["Option", "Default", "Meaning"],
      rows: [
        ["`watch`", "on for dev servers, off otherwise", "Run `lucent build --watch` alongside Metro. `false` turns it off, `true` forces it."],
      ],
    },
    {
      kind: "p",
      text: "The `LUCENT_WATCH` environment variable overrides the default when `watch` is not set: `LUCENT_WATCH=0` turns the watcher off, `LUCENT_WATCH=1` turns it on.",
    },
    {
      kind: "note",
      text: "Metro only swaps JavaScript. A change to a function body is native code: after the watcher rebuilds, rebuild and relaunch the app to run it. The [CLI](/docs/reference/cli/) page describes the build itself.",
    },
  ],
};
