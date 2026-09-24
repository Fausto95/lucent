import type { Block } from "../../types";

export const blocks: Block[] = [
  { kind: "diagram", diagram: "places" },
  {
    kind: "tabs",
    tabs: [
      {
        label: "shared",
        filename: "shapes.lucent.ts",
        code: `export type Point = { x: number; y: number };

export function nudge(p: Point): Point {
  p.x += 1;
  return p;
}

export class Counter {
  count = 0;
  increment(): number {
    return ++this.count;
  }
}`,
      },
      {
        label: "JS usage",
        filename: "App.tsx",
        code: `import { Counter, nudge } from "./src/shapes.lucent";

const p = { x: 0, y: 0 };
const q = nudge(p);
p.x; // 0: p was copied in
q === p; // false: q is a new object

const counter = new Counter();
counter.increment();
counter.count; // 1: the same native object`,
      },
    ],
  },
  { kind: "h2", text: "What crosses the boundary" },
  {
    kind: "table",
    head: ["Value", "Crosses as", "So"],
    rows: [
      ["`number`, `string`, `boolean`", "a copy", "the same value on the other side"],
      ["arrays, object types, `Record`, `Map`, `Set`, `Uint8Array`, `Date`", "a copy", "changes on one side don't reach the other"],
      ["class instances", "a reference", "the same object each time, with its identity"],
      ["functions", "a callback", "Lucent can call JavaScript back"],
      ["promises", "a promise", "`await` works in both directions"],
      ["errors", "an `Error`", "with its `message` and `code`"],
    ],
  },
  {
    kind: "p",
    text: "Copying is what makes the boundary safe: no JavaScript object is shared with native code. It is also what costs time, so large data should cross rarely.",
  },
  {
    kind: "p",
    text: "SDK objects, such as a `CLLocationManager`, stay in native code. JavaScript never sees them.",
  },
];
