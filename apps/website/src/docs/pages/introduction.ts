import type { DocPage } from "../types";

export const page: DocPage = {
  slug: "",
  title: "Introduction",
  description: "Lucent compiles a checked subset of TypeScript to C++ and calls it from React Native through JSI.",
  blocks: [
    {
      kind: "note",
      tone: "warn",
      text: "Lucent is **experimental** and not ready for production. The language subset and the APIs change without a migration path, and the packages are not on npm yet.",
    },
    {
      kind: "p",
      text: "Lucent lets you write React Native native modules in TypeScript. You put the code in `*.lucent.ts` files; the compiler checks it with the real TypeScript type checker and turns it into C++20. Your app calls it through JSI, the same way it calls any native module.",
    },
    {
      kind: "p",
      text: "It is for apps that want native speed for self-contained logic (parsers, codecs, hashing, geometry, data structures) without adding Swift, Kotlin or C++ to the codebase: the module stays in the language, review and tooling of the rest of the app. There is no JavaScript engine on the native side and no Swift or Kotlin is generated.",
    },
    { kind: "h2", text: "An example" },
    {
      kind: "code",
      filename: "geo.lucent.ts",
      code: `export type Point = { x: number; y: number };

export function squaredDistance(a: Point, b: Point): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return dx * dx + dy * dy;
}`,
    },
    {
      kind: "code",
      filename: "App.tsx",
      code: `import { squaredDistance } from "./src/geo.lucent";

squaredDistance({ x: 0, y: 0 }, { x: 3, y: 4 }); // 25, computed in C++`,
    },
    {
      kind: "p",
      text: "The import looks like an ordinary TypeScript import, and your editor type-checks it against the source. When Metro bundles the app, it replaces the module with a small proxy that calls the compiled C++. The call is synchronous; the object literals are converted to a C++ struct at the boundary.",
    },
    {
      kind: "p",
      text: "Lucent works in bare React Native (0.88) and Expo (SDK 58, development builds). It ships as one pure C++ TurboModule, autolinked by CocoaPods on iOS and CMake on Android. It does not depend on Expo Modules or Nitro.",
    },
    { kind: "h2", text: "What works today" },
    {
      kind: "list",
      items: [
        "The language minus platform SDKs and views: structs, unions, classes with inheritance and interfaces, closures, generics, `async`/`await`, errors, generators, `RegExp`, `JSON`, `Date`. See [the language](/docs/language/).",
        "JS callbacks, promises and `AbortSignal` across the boundary. See [exports](/docs/boundary/exports/).",
        "`lucent build` and `lucent check`, the Metro integration, the Expo config plugin, and editor diagnostics through a TypeScript plugin.",
        "Early platform modules (`*.ios.lucent.ts` / `*.android.lucent.ts`): Android bindings generated from `android.jar`, and a hand-written subset of UIKit on iOS. See [platform APIs](/docs/platform-apis/).",
      ],
    },
    { kind: "h2", text: "Not yet" },
    {
      kind: "list",
      items: [
        "Testing on physical devices. The example apps pass on the iOS simulator and the Android emulator.",
        "Bindings generated from the iOS SDK.",
        "Native views.",
        "Packages on npm.",
      ],
    },
    { kind: "p", text: "[Status & roadmap](/docs/status/) has the details." },
    { kind: "h2", text: "Next steps" },
    {
      kind: "cards",
      items: [
        {
          title: "Getting started",
          text: "Add Lucent to a bare React Native app and call your first module.",
          href: "/docs/getting-started/",
        },
        {
          title: "Getting started with Expo",
          text: "Use the config plugin in an Expo development build.",
          href: "/docs/getting-started-expo/",
        },
        {
          title: "How it works",
          text: "From a .lucent.ts file to C++ in your app binary.",
          href: "/docs/how-it-works/",
        },
        {
          title: "The language",
          text: "What the TypeScript subset supports and where it differs from JavaScript.",
          href: "/docs/language/",
        },
      ],
    },
  ],
};
