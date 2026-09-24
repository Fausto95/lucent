import type { Block } from "../../types";

export const blocks: Block[] = [
  {
    kind: "p",
    text: "Decide what JavaScript calls before writing the module. Each call crosses the boundary, and everything it passes is checked and copied.",
  },
  { kind: "h2", text: "Move the work, not the data" },
  {
    kind: "code",
    filename: "path.lucent.ts",
    code: `export type Point = { x: number; y: number };

// Before: JavaScript sends every point.
export function pathLength(points: Point[]): number {
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]!;
    const b = points[i]!;
    total += Math.hypot(b.x - a.x, b.y - a.y);
  }
  return total;
}

// After: the points are made here, and only a count crosses.
export function spiralLength(count: number): number {
  let total = 0;
  let px = 0;
  let py = 0;
  for (let i = 0; i < count; i++) {
    const x = Math.cos(i / 10) * i;
    const y = Math.sin(i / 10) * i;
    if (i > 0) total += Math.hypot(x - px, y - py);
    px = x;
    py = y;
  }
  return total;
}`,
  },
  { kind: "code", filename: "terminal", code: "npx lucent bench" },
  {
    kind: "code",
    filename: "terminal",
    copy: false,
    code: `CASE      JS         LUCENT     SPEEDUP
src/path.bench.ts
chatty    128.8 µs   104.9 µs   1.2x
objects   54.0 µs    67.1 µs    0.8x
numbers   50.8 µs    18.8 µs    2.7x
native    90.9 µs    7.9 µs     11.5x`,
  },
  {
    kind: "p",
    text: "These are four designs of one computation over 1,000 points, timed in desktop Hermes. `chatty` makes 1,000 calls with two numbers each, and `objects` is `pathLength`, copying 1,000 objects in one call.",
  },
  {
    kind: "p",
    text: "`numbers` passes two arrays of numbers instead, and `native` is `spiralLength`.",
  },
  {
    kind: "p",
    text: "Copying 1,000 objects costs more than the computation saves: the call is slower than JavaScript. Numbers are cheaper to copy than objects. Keeping the data in native code wins by far.",
  },
  { kind: "h2", text: "The checklist" },
  {
    kind: "list",
    items: [
      "Plain data in and out: numbers, strings, arrays and object types. Never an SDK object.",
      "Few calls that do a lot, over data that stays in native code, rather than many small calls.",
      "`async` for anything that may take more than a few milliseconds, so the JS thread stays free.",
      "Errors with a `code` JavaScript can test, from `error(code, message)`.",
      "A class when JavaScript needs a handle on native state: its instances cross by reference, not by copy.",
    ],
  },
  {
    kind: "p",
    text: "Measure with `lucent bench`. It times each case natively and as JavaScript, and fails when the two disagree.",
  },
];
