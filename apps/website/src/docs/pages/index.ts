import type { Block } from "../types";
import { clipboardUsage } from "../../content";
import { source as clipboard } from "../../generated/examples/clipboard";

export const blocks: Block[] = [
  {
    kind: "tabs",
    tabs: [
      {
        label: "shared",
        filename: "stats.lucent.ts",
        cpp: true,
        code: `export type Summary = { count: number; mean: number; max: number };

export function summarize(values: number[]): Summary {
  let sum = 0;
  let max = -Infinity;
  for (const value of values) {
    sum += value;
    if (value > max) max = value;
  }
  const mean = values.length > 0 ? sum / values.length : 0;
  return { count: values.length, mean, max };
}`,
      },
      {
        label: "JS usage",
        filename: "App.tsx",
        code: `import { summarize } from "./src/stats.lucent";

summarize([3, 1, 4, 1, 5]); // { count: 5, mean: 2.8, max: 5 }`,
      },
    ],
  },
  {
    kind: "p",
    text: "The TypeScript checker checks the module, Lucent compiles it to C++, and your app links that C++. The import in `App.tsx` stays an ordinary, typed import. When Metro bundles the app, it swaps the module for a small proxy that calls the C++.",
  },
  {
    kind: "p",
    text: "No JavaScript engine runs your module, and there's no Swift or Kotlin to write. Modules can also call iOS and Android APIs directly.",
  },
  { kind: "h2", text: "Call iOS and Android" },
  {
    kind: "tabs",
    tabs: [
      { label: "module", filename: "clipboard.lucent.ts", cpp: true, code: clipboard },
      { label: "JS usage", filename: "App.tsx", code: clipboardUsage },
    ],
  },
  {
    kind: "p",
    text: "A module imports the SDKs directly, typed from your Xcode and Android SDK. Each platform's build compiles its own branch. This is `expo-clipboard`'s API, from the [examples](/docs/examples/).",
  },
  { kind: "h2", text: "When to use it" },
  {
    kind: "list",
    items: [
      "Logic you want in native code: parsers, codecs, geometry, data structures.",
      "Calls to iOS and Android APIs, written once in TypeScript instead of in Swift and Kotlin.",
      "Work that must stay off the JS thread: `async` exports run on a background thread.",
    ],
  },
  { kind: "h2", text: "When not to use it" },
  {
    kind: "list",
    items: [
      "Native views. Lucent has none until milestone M3 ([roadmap](/docs/status/)).",
      "Production apps. Lucent is experimental, its APIs change without a migration path, and it isn't on npm yet.",
      "Code that needs `any`, `eval` or dynamic property access. Lucent compiles a checked subset of TypeScript.",
    ],
  },
  { kind: "h2", text: "How it compares" },
  {
    kind: "list",
    items: [
      "**Expo Modules and Turbo Native Modules**: you write Swift and Kotlin, and a JavaScript API over them.",
      "**Nitro Modules**: you write Swift, Kotlin or C++ against a TypeScript spec.",
      "**Lucent**: you write TypeScript, and the compiler writes the C++ and the calls into the SDK.",
    ],
  },
  { kind: "p", text: "[The comparison](/docs/comparison/) has the details, with dates and sources." },
];
