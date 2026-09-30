import type { Block } from "../../types";

export const blocks: Block[] = [
  { kind: "h2", text: "Xcode or the Android SDK" },
  {
    kind: "p",
    text: "Nothing to do. SDK types are cached per SDK version, so a new Xcode or `android.jar` is read again on the next build. Your code is then checked against the new SDK, and errors name what changed.",
  },
  { kind: "code", filename: "terminal", code: "npx lucent sdk prefetch" },
  {
    kind: "p",
    text: "This reads the new SDK's modules ahead of time, instead of during the first build. `lucent clean --cache` empties the cache, if it takes too much space.",
  },
  { kind: "h2", text: "Lucent" },
  {
    kind: "code",
    filename: "terminal",
    code: `npm i -D @lucent-lang/lucent@latest
npx lucent doctor
npx lucent build`,
  },
  {
    kind: "list",
    items: [
      "`lucent doctor` checks that every Lucent package in the app supports the new version.",
      "Rebuild the app, after `pod install` on iOS: the C++ runtime is part of the native package.",
      "Lucent is experimental, and APIs change without a migration path. Read the release notes first.",
    ],
  },
  { kind: "h2", text: "Pin the SDKs" },
  {
    kind: "code",
    filename: "terminal",
    code: `npx lucent sdk lock
npx lucent build --frozen
npx lucent sdk diff`,
  },
  {
    kind: "list",
    items: [
      "`lucent sdk lock` records the SDKs and the SDK members your code uses in `lucent-sdk.lock.json`. Commit it. It needs the SDK of every platform your project has code for; `--platforms ios` locks iOS alone.",
      "`--frozen` fails when an SDK or dependency differs from the lock. It also fails when a platform the lock lists has no SDK installed, or would be left to the Gradle build. Use it in CI and for releases, with `--platforms android` on a machine that only builds Android.",
      "`lucent sdk diff` lists what the installed SDKs remove or change among the members your code uses, before you rebuild the app. `--all` adds the other members of those modules.",
    ],
  },
  {
    kind: "p",
    text: "After changing Android dependencies, run `lucent build` first: it resolves the new classpath that `sdk diff` compares.",
  },
];
