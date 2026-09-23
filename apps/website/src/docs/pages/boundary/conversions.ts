import type { DocPage } from "../../types";

export const page: DocPage = {
  slug: "boundary/conversions",
  title: "Type conversions",
  description: "How each TypeScript type crosses between JavaScript and native code, and what happens when a caller passes the wrong thing.",
  blocks: [
    {
      kind: "p",
      text: "Every value that crosses the boundary is converted according to the declared TypeScript type. Plain data is copied; class instances keep their identity. The declared types are the contract: JavaScript callers can pass anything, so Lucent checks every argument before running any native code.",
    },
    { kind: "h2", text: "Conversion table" },
    {
      kind: "table",
      head: ["TypeScript", "JavaScript passes", "JavaScript receives"],
      rows: [
        ["`number`, `boolean`, `string`", "The same primitive", "The same primitive"],
        ["`enum`", "The member's value (a string or a number)", "The member's value"],
        ["`T[]`, `readonly T[]`", "An array; every element is checked", "A new array"],
        ["`[A, B]`", "An array", "A new array"],
        ["`Record<string, V>`", "An object; its own keys are copied", "A new plain object, in insertion order"],
        ["Object types (`type`, `interface` without methods)", "An object; declared fields are read by name, others are ignored", "A new plain object; optional fields that are `undefined` are left out"],
        ["`Map<K, V>`, `Set<T>`", "A `Map` or `Set`", "A new `Map` or `Set`"],
        ["`T | undefined`, `T | null`, `x?: T`", "`undefined` or `null` as declared, or a `T`", "`undefined`, `null` or a `T`"],
        ["Other unions", "Any member; see [Unions](#unions)", "The member's value"],
        ["`Uint8Array`", "A `Uint8Array` or `ArrayBuffer`; the bytes are copied", "A new `Uint8Array`"],
        ["`Date`", "A `Date`; its time value is copied", "A new `Date`"],
        ["`RegExp`", "A `RegExp` (source and flags; `lastIndex` is not kept)", "A new `RegExp`"],
        ["`Iterable<T>`", "Any iterable, as a snapshot (`Array.from`)", "Cannot be returned"],
        ["Classes", "An instance created by Lucent", "The same JS object every time; see [Object identity](/docs/boundary/identity/)"],
        ["Interfaces implemented by classes", "An instance of an implementing Lucent class", "The concrete class instance"],
        ["Functions", "A JS function; see [Callbacks](/docs/boundary/callbacks/)", "A callable JS function"],
        ["`Promise<T>`", "A promise returned by a callback", "A JS `Promise`"],
        ["`AbortSignal`", "A JS `AbortSignal`; see [Callbacks](/docs/boundary/callbacks/)", "Cannot be returned"],
      ],
    },
    { kind: "h2", text: "Values are copied" },
    {
      kind: "p",
      text: "Arrays, records, maps, sets, tuples, plain objects and dates cross as copies. Inside Lucent they are shared like in JavaScript, but a native function that mutates an array it received does not change the caller's array. Return the new value instead.",
    },
    {
      kind: "code",
      filename: "geometry.lucent.ts",
      code: `export type Point = { x: number; y: number };

export function midpoint(a: Point, b: Point): Point {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

export function normalize(points: Point[]): Point[] {
  const maxX = points.reduce((m, p) => Math.max(m, p.x), 1);
  for (const p of points) p.x /= maxX; // changes the native copy only
  return points;
}`,
    },
    {
      kind: "code",
      filename: "App.tsx",
      code: `import { midpoint, normalize } from "./geometry.lucent";

midpoint({ x: 0, y: 0 }, { x: 4, y: 2 }); // { x: 2, y: 1 }

const input = [{ x: 2, y: 0 }, { x: 4, y: 0 }];
const output = normalize(input);
input[1].x; // still 4
output[1].x; // 1`,
    },
    {
      kind: "p",
      text: "Copying is linear in the size of the value. For large data that JavaScript only passes through, keep it native: store it in a class instance and pass the instance, which crosses by reference.",
    },
    { kind: "h2", text: "Argument validation" },
    {
      kind: "p",
      text: "A value that does not match the declared type throws a `TypeError` before the function runs. The message names the function, the parameter and the path inside it:",
    },
    {
      kind: "code",
      filename: "App.tsx",
      code: `midpoint({ x: 0 }, { x: 4, y: 2 });
// TypeError: midpoint: argument 'a'.y must be a number, got undefined

normalize([{ x: 1, y: 1 }, "p2"]);
// TypeError: normalize: argument 'points'[1] must be an object, got a string`,
    },
    {
      kind: "p",
      text: "A missing argument is `undefined`, so it is accepted only by optional parameters and parameters with a default. Extra arguments are ignored.",
    },
    { kind: "h2", text: "Unions" },
    {
      kind: "p",
      text: "A value from JavaScript has no static type, so Lucent picks the union member at runtime. Primitive members are told apart by their JavaScript kind (number, string, boolean, array, function, object). Unions of object types need a string-literal discriminant, such as `kind`, that every member declares:",
    },
    {
      kind: "code",
      filename: "shapes.lucent.ts",
      code: `export type Shape =
  | { kind: "circle"; radius: number }
  | { kind: "rect"; w: number; h: number };

export function area(shape: Shape): number {
  switch (shape.kind) {
    case "circle":
      return Math.PI * shape.radius ** 2;
    case "rect":
      return shape.w * shape.h;
  }
}

export function describe(value: string | number): string {
  return typeof value === "number" ? value.toFixed(2) : value;
}`,
    },
    {
      kind: "p",
      text: "A union that JavaScript values cannot be told apart by fails the build with `LUCENT2005`; see [Diagnostics](/docs/language/diagnostics/).",
    },
    { kind: "h2", text: "What cannot cross" },
    {
      kind: "list",
      items: [
        "Generators and iterators (pass an `Iterable<T>` in, return an array out).",
        "`AbortController` (pass its `signal` instead), and `AbortSignal` from native code to JavaScript.",
        "Platform objects from `lucent:ios/*` and `lucent:android/*` (see [Platform APIs](/docs/platform-apis/)).",
        "Generic functions and classes: export a concrete wrapper.",
      ],
    },
    {
      kind: "p",
      text: "Using one of these in an exported signature is a compile error, not a runtime surprise:",
    },
    {
      kind: "code",
      filename: "range.lucent.ts",
      expect: "LUCENT2006",
      code: `export function* range(n: number): Generator<number> {
  for (let i = 0; i < n; i++) yield i;
}`,
    },
  ],
};
