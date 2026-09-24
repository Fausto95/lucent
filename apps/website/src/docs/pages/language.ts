import type { Block } from "../types";

export const blocks: Block[] = [
    {
      kind: "p",
      text: "A Lucent module is a file named `*.lucent.ts`. It must type-check with TypeScript in `strict` mode plus `noUncheckedIndexedAccess`, and it may only use the subset described in this section. The compiler turns each module into C++20; JavaScript calls its exports through JSI.",
    },
    { kind: "h2", text: "The contract" },
    {
      kind: "p",
      text: "**If a module type-checks and uses only the subset, it behaves exactly like the same code running in JavaScript.** Everything else fails in one of two ways:",
    },
    {
      kind: "list",
      items: [
        "At build time, with a `LUCENT` diagnostic that points at your source, when you use something the subset does not cover (`var`, `any`, `Symbol`, …). Lucent never hands invalid C++ to the native compiler.",
        "At run time, with a thrown error, where native code cannot match JavaScript. For example, writing past the end of an array throws a `RangeError` instead of creating holes.",
      ],
    },
    {
      kind: "p",
      text: "The known deviations are few and listed in [Differences from JavaScript](/docs/language/differences/). The diagnostic codes are listed in [Diagnostics](/docs/language/diagnostics/).",
    },
    { kind: "h2", text: "A first module" },
    {
      kind: "code",
      filename: "geo.lucent.ts",
      code: `export type Point = { x: number; y: number };

export function distance(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export function centroid(points: Point[]): Point | undefined {
  if (points.length === 0) return undefined;
  let x = 0;
  let y = 0;
  for (const p of points) {
    x += p.x;
    y += p.y;
  }
  return { x: x / points.length, y: y / points.length };
}`,
    },
    {
      kind: "code",
      filename: "App.tsx",
      code: `import { centroid, distance } from "./geo.lucent";

distance({ x: 0, y: 0 }, { x: 3, y: 4 }); // 5
centroid([]); // undefined`,
    },
    {
      kind: "p",
      text: "Nothing in the module is Lucent-specific: it is plain TypeScript, and the same file also runs as TypeScript, for example in unit tests. What makes it compile is that every value has a precise type. Writing return types on exports is not required, but it keeps the API that JavaScript sees explicit.",
    },
    { kind: "h2", text: "What the subset leaves out" },
    {
      kind: "p",
      text: "Most everyday TypeScript is in. The main exclusions are types with no native representation (`any`, `unknown` outside `catch`, intersections, `symbol`, `bigint`), dynamic features (`eval`, `Proxy`, `Symbol`, `WeakMap`, `Intl`), `var`, and top-level statements. Each gets a diagnostic, for example:",
    },
    {
      kind: "code",
      filename: "loose.lucent.ts",
      expect: "LUCENT2001",
      code: `export function first(xs: any[]): any {
  return xs[0];
}`,
    },
    {
      kind: "note",
      text: "Lucent is experimental. The subset grows over time; the [status page](/docs/status/) says what is ready.",
    },
    { kind: "h2", text: "In this section" },
    {
      kind: "cards",
      items: [
        { title: "Types & values", text: "Numbers, strings, arrays, objects, unions, optionals, enums, dates.", href: "/docs/language/types/" },
        { title: "Functions & closures", text: "Statements, destructuring, closures, generators, RegExp, JSON.", href: "/docs/language/functions/" },
        { title: "Classes", text: "Fields, accessors, inheritance, abstract classes, interfaces.", href: "/docs/language/classes/" },
        { title: "Generics", text: "Type parameters compiled to C++ templates.", href: "/docs/language/generics/" },
        { title: "Async & concurrency", text: "async/await, cancellation, and which thread runs what.", href: "/docs/language/async/" },
        { title: "Errors", text: "Error classes, codes, try/catch/finally.", href: "/docs/language/errors/" },
        { title: "Modules & imports", text: "What a module may contain, import and export.", href: "/docs/language/modules/" },
        { title: "Differences from JavaScript", text: "The deviations, memory and recursion.", href: "/docs/language/differences/" },
      ],
    },
    {
      kind: "p",
      text: "How values cross between JavaScript and native code (copies, class identity, callbacks, errors) is covered in the [boundary section](/docs/boundary/exports/).",
    },
];
