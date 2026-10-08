import type { Block, DocFrontmatter } from "../../types";
import { benchmarkRuns } from "../../../generated/benchmarks";

export const frontmatter: DocFrontmatter = {
  title: "Choose between Lucent, Expo Modules, Nitro and Turbo Native Modules",
  sidebar_label: "Compare with other tools",
  description:
    "All four reach native code over JSI: with Lucent you write a TypeScript subset instead of Swift, Kotlin or C++, and it's experimental.",
  kind: "explanation",
};

export const blocks: Block[] = [
  {
    kind: "comparison",
  },
  {
    kind: "p",
    text: "Each of the four puts your own native code in the app, so each needs a development build. Expo Go runs only the native modules it ships with.",
  },
  {
    kind: "h2",
    text: "What Lucent changes",
  },
  {
    kind: "list",
    items: [
      "**One codebase.** A module is one `.lucent.ts` file for iOS and Android. Its exports are the API, typed for JavaScript from its source. There's no spec or binding file to write, and no React Native codegen.",
      "**SDK calls in TypeScript.** Lucent types iOS and Android APIs from your Xcode, Android SDK, pods and Gradle dependencies. Swift-only and Kotlin-only APIs go through Swift and Kotlin that Lucent generates into the native package, so there's none to write.",
      "**Checks at build time.** A main-thread-only API outside code the main thread runs fails to compile. So does an API newer than the oldest OS the app runs on, without a version check ([SDK bindings](/docs/architecture/sdk-bindings/)).",
      "**Checked arguments.** Every argument is checked against its declared type before the module runs, except an enum's membership and a literal type's value. A wrong one throws a `TypeError` that names the argument ([The boundary](/docs/api/language/boundary/#when-a-value-doesnt-match)).",
      "**No data races.** Module code takes turns under one lock, as JavaScript runs one task at a time. Heavy work goes to `compute()` workers ([Concurrency](/docs/api/language/concurrency/)).",
      "**Native logic.** A module's own code, such as a parser or a codec, runs as C++ without a JavaScript engine.",
    ],
  },
  {
    kind: "h2",
    text: "What it costs",
  },
  {
    kind: "list",
    items: [
      "**It's experimental.** Its APIs change without a migration path, and it hasn't been tested on physical devices. The [known limitations](/docs/releases/roadmap/#known-limitations) list the rest.",
      "**A subset of TypeScript.** `any`, `eval` and a few dynamic features have no native form ([Why a subset](/docs/api/language/#why-a-subset)).",
      "**Copies at the boundary.** Arrays, objects and `Uint8Array`s are copied each time they cross. A `NativeBuffer` keeps bytes in native code instead ([Pass large buffers](/docs/guides/pass-large-buffers/)).",
      "**Gaps in the bindings.** Some SDK members can't be bound yet, nor can the Swift API of a Swift pod, though your app's Swift packages bind. `lucent sdk coverage` lists the gaps ([What isn't bound](/docs/api/ios-sdk/#what-isnt-bound)).",
      "**Experimental views.** Components are in preview ([Native views](/docs/guides/views/)). Keep a production Fabric component as it is.",
      "**A young ecosystem.** The example packages live in the repository, not on npm, while the other three tools have years of published libraries.",
    ],
  },
  {
    kind: "h2",
    text: "Performance",
  },
  {
    kind: "p",
    text: "All four call native code over JSI. A Lucent export is a JSI host function: it checks and converts each argument, runs your C++, then converts the result.",
  },
  {
    kind: "p",
    text: "Lucent publishes no numbers against the other three yet. The example apps' Compare tab times NitroBenchmarks' `addNumbers` and `addStrings` through each, in a Release build. Its results wait for physical devices.",
  },
  {
    kind: "p",
    text: "Each table below is one host run of `scripts/bench.ts`, not a phone's. It times Lucent against the same TypeScript in Hermes, and a call against a C++ TurboModule's bare host function. Times are medians.",
  },
  ...benchmarkRuns.flatMap((run): Block[] => [
    { kind: "h3", text: `${run.date}: ${run.name}` },
    {
      kind: "table",
      head: ["Run", ""],
      rows: [
        ["Machine", run.machine],
        ["Toolchain", run.toolchain],
        ...(run.commit ? [["Commit", `\`${run.commit}\``]] : []),
        ...(run.notes.length ? [["Notes", run.notes.join("; ")]] : []),
      ],
    },
    {
      kind: "table",
      head: ["Kernel", "JavaScript (ms)", "Lucent (ms)", "Speedup"],
      rows: run.kernels.map((k) => [
        `\`${k.name}\``,
        String(k.js),
        String(k.lucent),
        `${k.speedup}x`,
      ]),
    },
    {
      kind: "table",
      head: ["Crossing", "Lucent (µs)", "C++ host function (µs)", "Ratio"],
      rows: run.calls.map((c) => [c.name, String(c.lucent), String(c.cxx), `${c.ratio}x`]),
    },
  ]),
  {
    kind: "p",
    text: "The kernels are in [kernels.lucent.ts](https://github.com/Fausto95/lucent/blob/main/packages/compiler/test/e2e/cases/kernels.lucent.ts), and CI fails when a speedup falls below its budget. To publish a run, see [benchmarks/README.md](https://github.com/Fausto95/lucent/blob/main/benchmarks/README.md).",
  },
  {
    kind: "p",
    text: "`lucent bench` times your own module against the same code run as JavaScript ([Measure performance](/docs/guides/measure-performance/)). A call that copies more data than it computes on can be slower than JavaScript.",
  },
  {
    kind: "h2",
    text: "When to choose which",
  },
  {
    kind: "list",
    items: [
      "**Expo Modules**, when your team writes Swift and Kotlin, your app is built on Expo, or you need native views in production.",
      "**Nitro Modules**, when you want a TypeScript spec with C++, Swift or Kotlin behind it, and performance comes first.",
      "**Turbo Native Modules**, when you write a library that should depend on React Native core alone.",
      "**Lucent**, when you'd rather not keep Swift and Kotlin side by side, and the module can stay out of production for now.",
    ],
  },
  {
    kind: "p",
    text: "To move a module over, see [Port an Expo module](/docs/guides/port-an-expo-module/) or [Port a TurboModule or Nitro module](/docs/guides/port-a-turbomodule/).",
  },
  {
    kind: "h2",
    text: "Sources",
  },
  {
    kind: "p",
    text: "The other tools' cells were checked against their documentation on 2026-09-23. Lucent's follow its code, and its supported versions come from [Compatibility](/docs/api/compatibility/).",
  },
  {
    kind: "list",
    items: [
      "[Expo Modules overview](https://docs.expo.dev/modules/overview/)",
      "[Expo Module API](https://docs.expo.dev/modules/module-api/)",
      "[Expo modules in bare apps](https://docs.expo.dev/bare/installing-expo-modules/)",
      "[What is Nitro?](https://nitro.margelo.com/docs/what-is-nitro)",
      "[Nitro Hybrid Objects](https://nitro.margelo.com/docs/hybrid-objects)",
      "[Nitrogen](https://nitro.margelo.com/docs/nitrogen)",
      "[Nitro View Components](https://nitro.margelo.com/docs/view-components)",
      "[Nitro minimum requirements](https://nitro.margelo.com/docs/getting-started/minimum-requirements)",
      "[Turbo Native Modules](https://reactnative.dev/docs/turbo-native-modules-introduction)",
      "[Cross-platform C++ modules](https://reactnative.dev/docs/the-new-architecture/pure-cxx-modules)",
      "[Fabric Native Components](https://reactnative.dev/docs/fabric-native-components-introduction)",
    ],
  },
];
