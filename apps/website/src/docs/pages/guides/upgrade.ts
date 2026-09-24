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
  {
    kind: "note",
    tone: "warn",
    text: "There's no way yet to pin an SDK version, or to list the SDK changes that affect your code ([roadmap](/docs/status/)).",
  },
];
