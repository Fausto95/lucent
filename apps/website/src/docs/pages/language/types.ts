import type { Block } from "../../types";

export const blocks: Block[] = [
    {
      kind: "p",
      text: "Lucent reads your types to decide how each value is stored. You write ordinary TypeScript; this page says what each type becomes and where it differs from what you might expect.",
    },
    {
      kind: "table",
      head: ["TypeScript", "Native value", "Notes"],
      rows: [
        ["`number`", "`double`", "ECMAScript arithmetic: `%`, `**`, bitwise ops through ToInt32, `NaN`, `-0`"],
        ["`boolean`", "`bool`", ""],
        ["`string`, string literal types", "immutable UTF-16 string", "one byte per unit when possible"],
        ["`T[]`, `readonly T[]`", "shared array", "assignment aliases, as in JS"],
        ["`[A, B]`", "tuple", "a value; elements are read-only"],
        ["`Record<string, V>`", "string-keyed dictionary", "JS key order"],
        ["`Map<K, V>`, `Set<T>`", "insertion-ordered map and set", "SameValueZero keys"],
        ["object types", "shared struct", "one struct per shape"],
        ["`T | undefined`, `T | null`, `x?: T`", "optional", "remembers `undefined` vs `null`"],
        ["other unions", "tagged union", "narrowed like TypeScript"],
        ["`enum`", "number or string", ""],
        ["`Uint8Array`", "byte view over a shared buffer", ""],
        ["`Date`", "shared mutable time value", "local time uses the device's time zone"],
        ["`(a: A) => R`", "function value", "see [Functions & closures](/docs/language/functions/)"],
      ],
    },
    { kind: "h2", text: "Numbers, strings, booleans" },
    {
      kind: "p",
      text: "Numbers are doubles with JavaScript's rules, including `Math`, `Number` and number formatting (`toFixed`, `toString(radix)`, …). Where a local only ever holds integers from bitwise operations, the compiler keeps it in an integer register, which never changes a result. Strings are UTF-16 like JavaScript's, so `length`, indexing and `charCodeAt` count code units; `for…of` iterates code points.",
    },
    { kind: "h2", text: "Arrays, tuples and records" },
    {
      kind: "code",
      filename: "lists.lucent.ts",
      code: `export function aliasing(): number {
  const a = [1, 2];
  const b = a; // same array
  b.push(3);
  return a.length; // 3, as in JavaScript
}

export function swap(p: [string, number]): [number, string] {
  const [s, n] = p;
  return [n, s];
}

export function wordCounts(text: string): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const w of text.split(" ")) counts[w] = (counts[w] ?? 0) + 1;
  return counts;
}`,
    },
    {
      kind: "p",
      text: "Because of `noUncheckedIndexedAccess`, `xs[i]` and `record[k]` have type `T | undefined`: check the result, use `??`, or assert with `!` (which throws a `TypeError` if the value is missing). Tuples are values, so their elements cannot be assigned; build a new tuple instead.",
    },
    { kind: "h2", text: "Object types" },
    {
      kind: "p",
      text: "A `type` alias, an interface with only fields, and an object literal with the same fields all share one native struct, and values are shared by reference like JavaScript objects. Unlike TypeScript's structural typing, shapes must match **exactly**: an object with extra fields cannot be used where a smaller type is expected.",
    },
    {
      kind: "code",
      filename: "extra.lucent.ts",
      expect: "LUCENT2003",
      code: `type Point = { x: number; y: number };

export function norm(): number {
  const labelled = { x: 3, y: 4, label: "a" };
  const p: Point = labelled;
  return Math.hypot(p.x, p.y);
}`,
    },
    {
      kind: "p",
      text: "The same rule applies to collections: a `number[]` cannot be used as a `(number | string)[]` (`LUCENT2004`). Annotate the value with the target type where you create it.",
    },
    { kind: "h2", text: "Optionals: undefined and null" },
    {
      kind: "p",
      text: "`T | undefined`, `T | null`, `T | undefined | null` and optional fields (`x?: T`) are optionals. They keep the difference between `undefined` and `null`, so `===` and `??` behave as in JavaScript, as does optional chaining.",
    },
    {
      kind: "code",
      filename: "config.lucent.ts",
      code: `export type Config = { name: string; retries?: number; parent?: Config | null };

export function describe(c: Config): string {
  const retries = c.retries ?? 3;
  if (c.parent === null) return \`\${c.name} (root, \${retries} retries)\`;
  return \`\${c.name} under \${c.parent?.name ?? "?"}\`;
}`,
    },
    { kind: "h2", text: "Unions and narrowing" },
    {
      kind: "p",
      text: "Other unions are tagged unions. Narrow them the way you would in TypeScript: `typeof`, `instanceof`, comparisons, or a `switch` on a string-literal discriminant. The compiler follows TypeScript's own narrowing, so a value is only read as a member where the checker agrees.",
    },
    {
      kind: "code",
      filename: "shapes.lucent.ts",
      code: `export type Shape = { kind: "circle"; radius: number } | { kind: "rect"; w: number; h: number };

export function area(s: Shape): number {
  switch (s.kind) {
    case "circle":
      return Math.PI * s.radius * s.radius;
    case "rect":
      return s.w * s.h;
  }
}

export function show(v: number | string | boolean): string {
  if (typeof v === "number") return v.toFixed(2);
  if (typeof v === "string") return JSON.stringify(v);
  return v ? "yes" : "no";
}`,
    },
    {
      kind: "p",
      text: "A union of object types that crosses to JavaScript needs a string-literal discriminant like `kind`, so incoming values can be told apart (see [Conversions](/docs/boundary/conversions/)).",
    },
    { kind: "h2", text: "Enums, bytes and dates" },
    {
      kind: "code",
      filename: "misc.lucent.ts",
      code: `export enum Level {
  Low,
  High = 10,
}

export enum Mode {
  Fast = "fast",
  Safe = "safe",
}

export function checksum(bytes: Uint8Array): number {
  let sum = 0;
  for (const b of bytes) sum = (sum + b) % 256;
  return sum;
}

export function addDays(d: Date, days: number): Date {
  return new Date(d.getTime() + days * 86400000);
}`,
    },
    {
      kind: "p",
      text: "Numeric and string enums work as in TypeScript; exported enums become frozen JavaScript objects. `Uint8Array` supports indexing, iteration, `subarray` and the usual views over a shared buffer; `utf8Encode` and `utf8Decode` in `lucent:core` convert strings. `Date` supports construction, parsing, the `get…`/`set…` methods in local time and UTC, and `toISOString`/`toString`, but not the `toLocale…` methods.",
    },
    { kind: "h2", text: "Not supported" },
    {
      kind: "list",
      items: [
        "`any`, and `unknown` outside a `catch` clause (`LUCENT2001`).",
        "Intersections, `symbol`, `bigint`, `object`, `WeakMap`, `Intl` (`LUCENT2002`).",
        "Index signatures mixed with named properties, and getters in object literals.",
        "Using an object of one shape as another shape (`LUCENT2003`), or changing a collection's element type (`LUCENT2004`).",
      ],
    },
];
