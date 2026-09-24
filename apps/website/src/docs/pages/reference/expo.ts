import type { Block } from "../../types";

export const blocks: Block[] = [
    {
      kind: "p",
      text: "Expo apps generate their `ios` and `android` folders with `expo prebuild`. The Lucent config plugin makes sure the native package exists and is linked by then, so CocoaPods and Gradle find it.",
    },
    {
      kind: "code",
      filename: "app.json",
      code: `{
  "expo": {
    "name": "My App",
    "newArchEnabled": true,
    "plugins": ["@lucent-lang/lucent"]
  }
}`,
    },
    {
      kind: "p",
      text: "The plugin takes no options. It ships in `@lucent-lang/lucent` with the compiler it runs. You still need [`withLucent`](/docs/reference/metro/) in `metro.config.js`; the app needs no other Lucent package.",
    },
    { kind: "h2", text: "What it does on prebuild" },
    {
      kind: "steps",
      steps: [
        {
          title: "Builds",
          blocks: [
            {
              kind: "p",
              text: "Runs `lucent build --root <project root>` once per prebuild, for both platforms. If the build fails, the diagnostics are printed and prebuild stops with `lucent build failed; fix the errors above and run prebuild again`.",
            },
          ],
        },
        {
          title: "Links",
          blocks: [
            {
              kind: "p",
              text: "Writes `react-native.config.js` with the `lucent` entry if the file does not exist. Expo autolinking reads that file, so `pod install` and Gradle pick up `.lucent/native`. If the file exists without the entry, prebuild stops and tells you which entry to add:",
            },
            {
              kind: "code",
              filename: "react-native.config.js",
              code: `module.exports = {
  dependencies: {
    lucent: { root: require("path").join(__dirname, ".lucent", "native") },
  },
};`,
            },
          ],
        },
      ],
    },
    {
      kind: "p",
      text: "The plugin does not modify `Info.plist`, `AndroidManifest.xml` or any native project file. Lucent's module is a pure C++ TurboModule that autolinking registers on its own.",
    },
    { kind: "h2", text: "Development builds, not Expo Go" },
    {
      kind: "p",
      text: "Lucent modules are compiled into the app binary, so Expo Go cannot load them. Use a [development build](https://docs.expo.dev/develop/development-builds/introduction/): `npx expo run:ios` or `npx expo run:android` locally, or EAS Build. The New Architecture must be enabled (the default in recent Expo SDKs).",
    },
    {
      kind: "code",
      filename: "terminal",
      code: `npx expo prebuild     # runs lucent build, links .lucent/native
npx expo run:ios      # builds the dev client; Metro starts the Lucent watcher`,
    },
    {
      kind: "note",
      text: "The plugin builds only during prebuild. While you work, the watcher started by [`withLucent`](/docs/reference/metro/) keeps `.lucent/native` current; after it rebuilds native code, rebuild the app. Add `.lucent/` to `.gitignore`. See [Install Lucent](/docs/install/) for a full walkthrough.",
    },
];
