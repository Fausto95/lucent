import type { Block } from "../../types";
import { diffs, files } from "../../../generated/tutorial/8-publish";

export const blocks: Block[] = [
  {
    kind: "tabs",
    tabs: [
      {
        label: "package.json",
        filename: "trip-tracker/package.json",
        code: files["trip-tracker/package.json"]!,
      },
      {
        label: "lucent.json",
        filename: "trip-tracker/lucent.json",
        code: files["trip-tracker/lucent.json"]!,
      },
      {
        label: "index.ts",
        filename: "trip-tracker/index.ts",
        code: files["trip-tracker/index.ts"]!,
      },
      { label: "App.tsx", filename: "App.tsx", diff: true, code: diffs["App.tsx"]! },
    ],
  },
  {
    kind: "p",
    text: "Move `src/` into a folder of its own, `trip-tracker/`, and add these three files. The package ships the modules as source: an app that installs it compiles them with its own modules, into its one native package.",
  },
  {
    kind: "list",
    items: [
      "`lucent.sources` names the folder with the modules. `lucent.compatible` is the range of Lucent versions the package supports.",
      "`index.ts` re-exports the modules. Metro swaps each for its proxy, as in an app.",
      "`lucent.json` lists what the modules need from the app. Here it's the `Info.plist` entry, so apps no longer add it by hand.",
      "The modules are named `trip-tracker/trip` and `trip-tracker/location`, so they can't clash with an app's own `trip` module.",
    ],
  },
  { kind: "code", filename: "terminal", code: "npm publish" },
  {
    kind: "p",
    text: "In an app that installs `trip-tracker`, `lucent build` finds it and builds its modules. The Expo config plugin writes the `Info.plist` entry. In a bare app, `lucent build` names the missing key:",
  },
  {
    kind: "code",
    filename: "terminal",
    copy: false,
    code: `✓ Native package  .lucent/native
! trip-tracker needs NSLocationWhenInUseUsageDescription in ios/App/Info.plist (the Expo config plugin adds it)

modules  trip-tracker/location  ios android
         trip-tracker/trip      shared`,
  },
  {
    kind: "p",
    text: "You've built a module with shared logic, async work, errors, platform code, callbacks and permissions, and published it. The [examples](/docs/examples/) show more modules built the same way.",
  },
];
