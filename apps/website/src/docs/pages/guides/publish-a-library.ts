import type { Block } from "../../types";
import { files } from "../../../generated/tutorial/8-publish";

export const blocks: Block[] = [
  {
    kind: "tabs",
    tabs: [
      { label: "package.json", filename: "trip-tracker/package.json", code: files["trip-tracker/package.json"]! },
      { label: "index.ts", filename: "trip-tracker/index.ts", code: files["trip-tracker/index.ts"]! },
      { label: "lucent.json", filename: "trip-tracker/lucent.json", code: files["trip-tracker/lucent.json"]! },
    ],
  },
  {
    kind: "list",
    items: [
      "`lucent.sources` is the folder with the package's modules. `lucent.compatible` is the range of Lucent versions it supports; an app outside it fails to build, naming the package.",
      "`main` re-exports the modules. Metro swaps each for its proxy in the app.",
      "The package ships sources only. The app compiles them with its own modules, with its own Lucent, into its one native package.",
      "`lucent.json` lists what the modules need from the app: pods, Gradle dependencies, permissions, `Info.plist` entries. The app's build merges them, and fails if two packages disagree. See [`lucent.json`](/docs/reference/lucent-json/).",
      "Modules are named `<package>/<module>`, so two packages can each have a `storage` module.",
    ],
  },
  { kind: "code", filename: "terminal", code: "npm publish" },
  {
    kind: "p",
    text: "This is the tutorial's package, which [step 8](/docs/tutorial/8-publish/) makes. [examples/lucent-haptics](https://github.com/Fausto95/lucent/tree/main/examples/lucent-haptics) is another.",
  },
];
