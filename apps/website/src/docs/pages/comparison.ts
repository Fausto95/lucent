import { comparisonTable } from "../comparison-table";
import type { DocPage } from "../types";

export const page: DocPage = {
  slug: "comparison",
  title: "Comparison",
  description: "How Lucent compares with Expo Modules, Nitro Modules and Turbo Native Modules, and when to pick each.",
  blocks: [
    {
      kind: "p",
      text: "Expo Modules, Nitro Modules, Turbo Native Modules and Lucent all let JavaScript call native code synchronously over JSI. They differ in what you write: which languages, how the interface to JavaScript is declared, and how much of the platform you can reach today.",
    },
    comparisonTable,
    {
      kind: "p",
      text: "Custom native code of any of these kinds needs a development build; it does not run in Expo Go. For what Lucent generates and how the call reaches it, see [How it works](/docs/how-it-works/).",
    },
    { kind: "h2", text: "Performance" },
    {
      kind: "p",
      text: "Lucent uses the same JSI call path as Nitro Modules and C++ Turbo Native Modules. We make no other speed claims yet.",
    },
    {
      kind: "p",
      text: "A benchmark is planned: the same module implemented four ways, measuring an empty call repeated 100,000 times, hashing 1 MB, and passing a 10,000-number array and a 1 MB string across the boundary. It will run on the iOS simulator, the Android emulator and one real device per platform. The numbers will be published together with the method and the code.",
    },
    { kind: "h2", text: "When to pick each" },
    {
      kind: "list",
      items: [
        "**Expo Modules**: your team already writes Swift and Kotlin, or you need views and full platform SDK access today.",
        "**Nitro Modules**: you want the most performance you can get, are fine writing C++, Swift or Kotlin, and like declaring the interface in TypeScript first.",
        "**Turbo Native Modules**: you are writing a library that should depend only on React Native core.",
        "**Lucent**: your team works in TypeScript and wants native-speed logic without writing Swift or Kotlin, and today's scope (early platform SDK access, no views) is enough.",
      ],
    },
    {
      kind: "note",
      text: "Last checked: 2026-09-23. Sources: [Expo Modules overview](https://docs.expo.dev/modules/overview/), [Expo Module API](https://docs.expo.dev/modules/module-api/), [Expo modules in bare apps](https://docs.expo.dev/bare/installing-expo-modules/), [Add custom native code](https://docs.expo.dev/workflow/customizing/), [What is Nitro?](https://nitro.margelo.com/docs/what-is-nitro), [Nitro Hybrid Objects](https://nitro.margelo.com/docs/hybrid-objects), [Nitrogen](https://nitro.margelo.com/docs/nitrogen), [Nitro View Components](https://nitro.margelo.com/docs/view-components), [Nitro minimum requirements](https://nitro.margelo.com/docs/getting-started/minimum-requirements), [Turbo Native Modules](https://reactnative.dev/docs/turbo-native-modules-introduction), [Cross-platform C++ modules](https://reactnative.dev/docs/the-new-architecture/pure-cxx-modules), [Swift in native modules](https://reactnative.dev/docs/the-new-architecture/turbo-modules-with-swift), [Fabric Native Components](https://reactnative.dev/docs/fabric-native-components-introduction). Corrections are welcome.",
    },
  ],
};
