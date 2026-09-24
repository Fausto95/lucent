import type { Block } from "../../types";

export const blocks: Block[] = [
    { kind: "h2", text: "What a module contains" },
    {
      kind: "p",
      text: "The top level of a Lucent module may only contain **declarations**: imports, functions, classes, interfaces, type aliases, enums, and `const`/`let` variables. There is no top-level code to run on load, so a module has nothing to initialize except its variables.",
    },
    {
      kind: "code",
      filename: "shapes.lucent.ts",
      code: `export type Point = { x: number; y: number };

export const ORIGIN: Point = { x: 0, y: 0 };

let created = 0; // module state

export class Vec {
  constructor(
    public x: number,
    public y: number,
  ) {
    created++;
  }
  plus(o: Vec): Vec {
    return new Vec(this.x + o.x, this.y + o.y);
  }
}

export function vectorsCreated(): number {
  return created;
}`,
    },
    {
      kind: "p",
      text: "A statement such as a call or an assignment at the top level is rejected:",
    },
    {
      kind: "code",
      filename: "setup.lucent.ts",
      expect: "LUCENT3002",
      code: `const cache = new Map<string, number>();
cache.set("answer", 42);

export function lookup(key: string): number | undefined {
  return cache.get(key);
}`,
    },
    {
      kind: "p",
      text: "Move such setup into the initializer (`new Map([[\"answer\", 42]])`) or into a function that runs on first use.",
    },
    { kind: "h2", text: "Module state" },
    {
      kind: "p",
      text: "Top-level variables live as long as the JS runtime. When the app reloads its JavaScript (for example from the dev menu), every Lucent module's state is reset to its initial values, just like a JavaScript module's.",
    },
    { kind: "h2", text: "Imports" },
    {
      kind: "p",
      text: "A module can import from other `*.lucent.ts` files (written without the `.ts` extension) and from `lucent:core`. Named imports and `type` imports work; anything else, such as an npm package or a plain `.ts` file, is not allowed, because it has no native implementation.",
    },
    {
      kind: "code",
      filename: "paths.lucent.ts",
      code: `import { now } from "lucent:core";
import { Vec, type Point } from "./shapes.lucent";

export function sum(points: Point[]): Point {
  let v = new Vec(0, 0);
  for (const p of points) v = v.plus(new Vec(p.x, p.y));
  return { x: v.x, y: v.y };
}

export function timedSum(points: Point[]): number {
  const start = now();
  sum(points);
  return now() - start;
}`,
    },
    {
      kind: "p",
      text: "The helpers in `lucent:core` (`delay`, `error`, `errorCode`, `utf8Encode`, `utf8Decode`, `now`) are listed in the [core reference](/docs/reference/core/).",
    },
    { kind: "h2", text: "Module names" },
    {
      kind: "p",
      text: "A module's name is its file name without `.lucent.ts`: `src/geo/shapes.lucent.ts` is the module `shapes`. Names must be unique within an app, even across folders.",
    },
    { kind: "h2", text: "Exports" },
    {
      kind: "p",
      text: "Only exported declarations are visible to JavaScript, which imports them from the same path (`import { sum } from \"./paths.lucent\"`).",
    },
    {
      kind: "table",
      head: ["Export", "What JavaScript sees"],
      rows: [
        ["`export function`", "a function; `async` ones return a promise"],
        ["`export class`", "a class, constructed with `new`"],
        ["`export const`", "the value, copied to JavaScript once"],
        ["`export enum`", "a frozen object"],
        ["`export type`, `export interface`", "nothing at run time; types are free"],
      ],
    },
    {
      kind: "p",
      text: "Export each declaration where it is written. Export lists (`export { a, b }`) and re-exports (`export … from`) are not supported:",
    },
    {
      kind: "code",
      filename: "api.lucent.ts",
      expect: "LUCENT3003",
      code: `function area(w: number, h: number): number {
  return w * h;
}

export { area };`,
    },
    {
      kind: "p",
      text: "Everything an export takes or returns must be able to cross the boundary: generic functions and classes cannot be exported ([Generics](/docs/language/generics/)), and generators cannot be returned. The conversion rules are in [Exports](/docs/boundary/exports/).",
    },
    { kind: "h2", text: "Platform modules" },
    {
      kind: "p",
      text: "A module can have per-platform implementations: `haptics.ios.lucent.ts` and `haptics.android.lucent.ts` implement what `haptics.lucent.ts` declares, and only they may import the platform SDKs. See [Platform APIs](/docs/platform-apis/).",
    },
];
