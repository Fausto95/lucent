import type { Block } from "../../types";

export const blocks: Block[] = [
  { kind: "h2", text: "Metro: withLucent" },
  {
    kind: "code",
    filename: "metro.config.js",
    code: `const { getDefaultConfig } = require("expo/metro-config");
const { withLucent } = require("@lucent-lang/lucent/metro");

module.exports = withLucent(getDefaultConfig(__dirname), { watch: true });`,
  },
  {
    kind: "table",
    head: ["Option", "Default", "Meaning"],
    rows: [
      [
        "`watch`",
        "on for `start`, `run:ios` and `run:android`",
        "Runs `lucent dev --compact` next to the dev server, which rebuilds the native package on each save. `LUCENT_WATCH=0` or `1` sets it when `watch` isn't given.",
      ],
    ],
  },
  {
    kind: "list",
    items: [
      "Each `*.lucent.ts` file is bundled as its proxy, `.lucent/native/js/<module>.js`. A module that was never built bundles an error: `Lucent: <file> has not been compiled. Run lucent build and rebuild the app.`",
      "The watcher prints one line per build in Metro's output and never reads Metro's keys. It stops with Metro.",
      "`withLucent` goes in front of the config's Babel transformer, or React Native's or Expo's default one.",
    ],
  },
  { kind: "h2", text: "Expo: the config plugin" },
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
    text: "The plugin takes no options. During `expo prebuild`, it:",
  },
  {
    kind: "list",
    items: [
      "runs `lucent build` once; a failed build stops prebuild with the errors;",
      "creates `react-native.config.js` with the `lucent` entry, or stops and names the entry to add if the file exists without it;",
      "applies the Gradle task that runs `lucent build` before each Android build (Groovy `build.gradle` only);",
      "adds the `Info.plist` entries that Lucent packages list in their `lucent.json`, unless the app sets the key itself.",
    ],
  },
  {
    kind: "p",
    text: "Lucent adds native code, so Expo Go can't load it. Use a development build: `npx expo run:ios`, `npx expo run:android` or EAS Build.",
  },
  { kind: "h2", text: "Editor plugin" },
  {
    kind: "code",
    filename: "tsconfig.json",
    code: `{
  "compilerOptions": {
    "noUncheckedIndexedAccess": true,
    "paths": { "lucent:*": ["./.lucent/native/types/*"] },
    "plugins": [{ "name": "@lucent-lang/lucent/ts-plugin" }]
  }
}`,
  },
  {
    kind: "p",
    text: '`lucent init` adds the first two; the plugin line is yours to add. The plugin shows Lucent\'s errors, with their fix and code, in `*.lucent.ts` files. In VS Code, pick "Use Workspace Version" of TypeScript so it loads.',
  },
];
