import type { DocPage } from "../types";

export const page: DocPage = {
  slug: "",
  title: "Introduction",
  description:
    "Lucent compiles a typed subset of TypeScript to Swift and Kotlin ahead of time. Write native React Native modules and views without leaving TypeScript.",
  blocks: [
    {
      kind: "note",
      tone: "warn",
      text: "**Experimental — do not use Lucent in production.** The language, generated native code and `@lucent-lang/*` APIs change without a migration path. The Expo example app exercises the native contract on simulator; full device matrices and a 1.0 release are still open.",
    },
    { kind: "h2", text: "What it is" },
    {
      kind: "p",
      text: "A `*.lucent.ts` file is a native module. A `*.lucent.tsx` file is a native view. Lucent type-checks and compiles them to Swift and Kotlin, then wraps the result as an Expo Module or a Nitro HybridObject. Your app imports the file like TypeScript; the call runs as compiled native code.",
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
      text: "There is no JavaScript engine on the native side. What you write compiles to readable Swift and Kotlin.",
    },
    { kind: "h2", text: "What you can build" },
    {
      kind: "list",
      items: [
        "**Functions** over numbers, strings, records, unions, arrays, maps, bytes — sync or async. [Language →](/docs/language/)",
        "**Native classes**, resources, subscriptions, task scopes and events. [Native classes →](/docs/language/native-classes/)",
        "**Views** in TSX with `state()`, `resource()` and `effect()`, rendered by SwiftUI and Compose. [Native views →](/docs/language/native-views/)",
        "**SDK packages** through manifests and overlays — camera and friends as CI stubs today. [What you can build today →](/docs/what-you-can-build/)",
      ],
    },
    { kind: "h2", text: "Why not write Swift and Kotlin twice" },
    {
      kind: "p",
      text: "Shared feature logic drifts when it lives in two languages. Lucent keeps one checked source for the Expo / Nitro boundary and generates both backends. Use hand-written Swift or Kotlin when you need the full language or an SDK the subset cannot express.",
    },
    { kind: "h2", text: "What it is not" },
    {
      kind: "p",
      text: "Not full TypeScript: no `any`, user generics, `switch`, or `try`/`catch` inside Lucent. Outside the subset fails with an `LUCENT` diagnostic at build time. Not a UI framework: React owns the app shell; Lucent views own native control and resource state.",
    },
    { kind: "h2", text: "Where to go next" },
    {
      kind: "cards",
      items: [
        {
          title: "What you can build today",
          text: "Covered shapes, CI stubs, and what still needs devices.",
          href: "/docs/what-you-can-build/",
        },
        {
          title: "Getting started",
          text: "Wire Expo or bare React Native and run a first module.",
          href: "/docs/getting-started/",
        },
        {
          title: "How it works",
          text: "Parse → check → HIR → Swift / Kotlin → host package.",
          href: "/docs/how-it-works/",
        },
        {
          title: "Examples",
          text: "Modules and views from the example apps.",
          href: "/docs/examples/",
        },
      ],
    },
  ],
};
