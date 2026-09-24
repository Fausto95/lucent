import type { Block } from "../types";

const install = `npm i -D @lucent-lang/lucent
npx lucent init`;

export const blocks: Block[] = [
  {
    kind: "note",
    tone: "warn",
    text: "`@lucent-lang/lucent` isn't on npm yet. Until it is, run `pnpm pack` in the repository's `packages/lucent` and install the tarball it writes ([roadmap](/docs/roadmap/)).",
  },
  {
    kind: "p",
    text: "You need React Native 0.88 or later, or Expo SDK 58 in a development build, and Node 22.12 or later.",
  },
  {
    kind: "panels",
    panels: [
      {
        label: "Expo",
        blocks: [
          { kind: "code", filename: "terminal", code: install },
          { kind: "p", text: "`lucent init` shows each change as a diff and asks before applying it. In an Expo app, it:" },
          {
            kind: "list",
            items: [
              "wraps `metro.config.js` with `withLucent`, so Metro bundles each module as a proxy;",
              "adds the `@lucent-lang/lucent` config plugin to `app.json`, which builds your modules during `expo prebuild`;",
              "maps `lucent:*` imports and turns on `noUncheckedIndexedAccess` in `tsconfig.json`;",
              "adds `.lucent/` to `.gitignore`;",
              "writes a first module, `src/hello.lucent.ts`, if the app has none.",
            ],
          },
          {
            kind: "note",
            text: "Lucent adds native code, so it doesn't run in Expo Go. Run the app as a development build, with `npx expo run:ios` or `npx expo run:android`.",
          },
        ],
      },
      {
        label: "Bare React Native",
        blocks: [
          { kind: "code", filename: "terminal", code: install },
          { kind: "p", text: "`lucent init` shows each change as a diff and asks before applying it. In a bare app, it:" },
          {
            kind: "list",
            items: [
              "wraps `metro.config.js` with `withLucent`, so Metro bundles each module as a proxy;",
              "adds a `lucent` entry to `react-native.config.js`, so autolinking finds the native package in `.lucent/native`;",
              "applies a Gradle task in `android/app/build.gradle` that runs `lucent build` before each Android build;",
              "maps `lucent:*` imports and turns on `noUncheckedIndexedAccess` in `tsconfig.json`;",
              "adds `.lucent/` to `.gitignore`;",
              "writes a first module, `src/hello.lucent.ts`, if the app has none.",
            ],
          },
        ],
      },
    ],
  },
  {
    kind: "p",
    text: "Run `npx lucent init --yes` to apply every change without asking. Running it again changes nothing.",
  },
  { kind: "h2", text: "Check your machine" },
  { kind: "code", filename: "terminal", code: "npx lucent doctor" },
  {
    kind: "code",
    filename: "terminal",
    copy: false,
    code: `◆ lucent doctor 0.0.3

✓ Node.js                v24.16.0
✓ React Native           0.88.0
✓ Xcode                  27.0
✓ CocoaPods              1.16.2
! JDK                    27; React Native's Gradle build needs 17 to 21
    fix  set JAVA_HOME to JDK 17 or 21 (macOS: export JAVA_HOME=$(/usr/libexec/java_home -v 21))
✓ Metro config           metro.config.js uses withLucent

1 warning`,
  },
  {
    kind: "p",
    text: "It checks Node, React Native, Xcode, CocoaPods, the Android SDK, NDK and JDK, the Metro config and the Gradle task. Each problem comes with its fix. The output above is shortened.",
  },
  { kind: "h2", text: "See Lucent's errors in your editor" },
  {
    kind: "code",
    filename: "tsconfig.json",
    code: `{
  "compilerOptions": {
    "plugins": [{ "name": "@lucent-lang/lucent/ts-plugin" }]
  }
}`,
  },
  {
    kind: "p",
    text: "TypeScript accepts code that Lucent rejects, such as `any`. The plugin shows Lucent's errors as you type; `lucent init` doesn't add it. In VS Code, pick \"Use Workspace Version\" of TypeScript so the plugin loads.",
  },
];
