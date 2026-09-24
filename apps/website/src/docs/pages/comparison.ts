import type { Block } from "../types";

export const blocks: Block[] = [
    {
      kind: "p",
      text: "Expo Modules, Nitro Modules, Turbo Native Modules and Lucent all let JavaScript call native code synchronously over JSI. They differ in the languages you write, how the interface is declared, and how much of the platform you reach today.",
    },
    { kind: "comparison" },
    {
      kind: "p",
      text: "Native code of any of these kinds needs a development build: it doesn't run in Expo Go. [How a module becomes native code](/docs/how-it-works/) shows what Lucent generates.",
    },
    { kind: "h2", text: "Performance" },
    {
      kind: "p",
      text: "Lucent calls go through JSI into C++, like Nitro Modules and C++ Turbo Native Modules. We publish no speed comparison between these tools. `lucent bench` measures your own module against the same code run as JavaScript.",
    },
    { kind: "h2", text: "When to pick each" },
    {
      kind: "list",
      items: [
        "**Expo Modules**: your team already writes Swift and Kotlin, or you need views and full platform SDK access today.",
        "**Nitro Modules**: you want the most performance, write C++, Swift or Kotlin, and like declaring the interface in TypeScript first.",
        "**Turbo Native Modules**: you are writing a library that should depend only on React Native core.",
        "**Lucent**: you want native code without adding Swift, Kotlin or C++ to the codebase. You can do without views and an npm release for now.",
      ],
    },
    { kind: "h2", text: "Sources" },
    {
      kind: "p",
      text: "The other tools were last checked on 2026-09-23, and Lucent's rows updated on 2026-09-24. Corrections are welcome.",
    },
    {
      kind: "list",
      items: [
        "[Expo Modules overview](https://docs.expo.dev/modules/overview/)",
        "[Expo Module API](https://docs.expo.dev/modules/module-api/)",
        "[Expo modules in bare apps](https://docs.expo.dev/bare/installing-expo-modules/)",
        "[Add custom native code](https://docs.expo.dev/workflow/customizing/)",
        "[What is Nitro?](https://nitro.margelo.com/docs/what-is-nitro)",
        "[Nitro Hybrid Objects](https://nitro.margelo.com/docs/hybrid-objects)",
        "[Nitrogen](https://nitro.margelo.com/docs/nitrogen)",
        "[Nitro View Components](https://nitro.margelo.com/docs/view-components)",
        "[Nitro minimum requirements](https://nitro.margelo.com/docs/getting-started/minimum-requirements)",
        "[Turbo Native Modules](https://reactnative.dev/docs/turbo-native-modules-introduction)",
        "[Cross-platform C++ modules](https://reactnative.dev/docs/the-new-architecture/pure-cxx-modules)",
        "[Swift in native modules](https://reactnative.dev/docs/the-new-architecture/turbo-modules-with-swift)",
        "[Fabric Native Components](https://reactnative.dev/docs/fabric-native-components-introduction)",
      ],
    },
];
