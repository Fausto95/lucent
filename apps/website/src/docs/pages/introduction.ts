import type { DocPage } from "../types";

export const page: DocPage = {
  slug: "",
  title: "Introduction",
  description:
    "Lucent compiles a typed subset of TypeScript to Swift and Kotlin ahead of time. Write native React Native modules and views without leaving TypeScript.",
  blocks: [
    { kind: "h2", text: "What it is" },
    {
      kind: "p",
      text: "A `*.lucent.ts` file is a native module. A `*.lucent.tsx` file is a native view. Lucent parses, type-checks and compiles them to Swift and Kotlin, then wraps the result as an Expo Module or a Nitro HybridObject. Your app imports the file like any other TypeScript module; at runtime the call lands in compiled native code.",
    },
    {
      kind: "code",
      filename: "src/geo.lucent.ts",
      code: "export type Point = { x: number; y: number };\n\nexport function squaredDistance(a: Point, b: Point): number {\n  const dx = a.x - b.x;\n  const dy = a.y - b.y;\n  return dx * dx + dy * dy;\n}",
    },
    {
      kind: "code",
      filename: "App.tsx",
      code: 'import { squaredDistance } from "./src/geo.lucent";\n\nsquaredDistance({ x: 0, y: 0 }, { x: 3, y: 4 }); // 25, computed in Swift / Kotlin',
    },
    {
      kind: "p",
      text: "There is no JavaScript engine on the native side and no interpreter. What you write is what runs, as readable Swift and Kotlin you can open in Xcode or Android Studio.",
    },
    { kind: "h2", text: "What you can build" },
    {
      kind: "list",
      items: [
        "**Functions** over numbers, strings, booleans, records, arrays, maps, bytes and optionals, sync or async. [Language →](/docs/language/)",
        "**Native classes** whose state stays in native memory; JavaScript holds a handle. [Native classes →](/docs/language/native-classes/)",
        "**Typed events** emitted from native code and subscribed to from the app. [Events →](/docs/language/events/)",
        "**Native views** written in TSX and rendered by SwiftUI and Jetpack Compose, with controls such as `TextField`, `Toggle` and `Slider`. [Native views →](/docs/language/native-views/)",
        "**Platform access** through a small standard library (files, crypto, network, device), typed capabilities, and bindings to real SDK classes. [Platform →](/docs/language/platform-and-capabilities/)",
      ],
    },
    { kind: "h2", text: "Why not write Swift and Kotlin" },
    {
      kind: "p",
      text: "Because the logic would exist twice, and the two copies drift. Lucent's job is the Expo and Nitro boundary: one checked source, generated Swift and Kotlin, and a typed JavaScript proxy. The novel part is that interop — classes, events, views, and the proxy — not a general transpiler.",
    },
    {
      kind: "table",
      head: ["Use this instead", "When"],
      rows: [
        ["Swift and Kotlin", "You need the full language, an SDK the subset cannot express, or you are happy to maintain both."],
        ["JSI or a TurboModule", "You already have native code and only need a thin, hand-written call across the bridge."],
        ["Nitro, without Lucent", "You want to author the HybridObject in Swift and Kotlin yourself."],
        ["Wasm", "The code must run in a portable runtime, including on the JavaScript side."],
      ],
    },
    { kind: "h2", text: "What it is not" },
    {
      kind: "p",
      text: "Lucent is not TypeScript with a native backend. The subset is listed on the [language](/docs/language/) and [functions](/docs/language/functions-and-control-flow/) pages: no `any`, no generics, no `switch`, no `try`/`catch`, no dynamic property access. Arrow callbacks exist inside native code, with explicit captures; a function value still cannot cross into JavaScript. Everything outside the subset fails with an `NT` diagnostic at build time. It is also not a UI framework: React owns app state and effects. A view may keep control state on the host instance.",
    },
    {
      kind: "note",
      tone: "warn",
      text: "Pre-release. The language and the package APIs will change before 0.1.0. Both example apps in the repository pass on iOS and Android with Expo SDK 58 and Nitro 0.37.",
    },
    { kind: "h2", text: "Where to go next" },
    {
      kind: "cards",
      items: [
        {
          title: "Getting started",
          text: "Install into an Expo or bare React Native app and run your first module.",
          href: "/docs/getting-started/",
        },
        {
          title: "How it works",
          text: "The pipeline from source to native package, and what happens at runtime.",
          href: "/docs/how-it-works/",
        },
        {
          title: "Examples",
          text: "Annotated modules, views and packages taken from the example apps.",
          href: "/docs/examples/",
        },
        {
          title: "API reference",
          text: "Every `@lucent-lang/*` package, the CLI, plugins and the library manifest.",
          href: "/docs/api/",
        },
      ],
    },
  ],
};
