import { compute } from "lucent:core";

// A recursive alias for JSON-shaped data: it compiles, crosses to and from
// JavaScript at any depth, narrows with typeof and Array.isArray, and
// round-trips through JSON.parse and JSON.stringify.

export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

/** How deep the arrays and objects nest. */
export function depth(v: Json): number {
  if (Array.isArray(v)) {
    let d = 0;

    for (const x of v) d = Math.max(d, depth(x));

    return d + 1;
  }

  if (v !== null && typeof v === "object") {
    let d = 0;

    for (const k of Object.keys(v)) d = Math.max(d, depth(v[k] ?? null));

    return d + 1;
  }

  return 0;
}

/** What each value is, as JavaScript tells. */
export function kind(v: Json): string {
  if (v === null) return "null";
  if (Array.isArray(v)) return `array of ${v.length}`;
  if (typeof v === "object") return `object of ${Object.keys(v).length}`;
  return typeof v;
}

export function echo(v: Json): Json {
  return v;
}

export function parse(text: string): Json {
  return JSON.parse(text) as Json;
}

export function stringify(v: Json): string {
  return JSON.stringify(v);
}

export function made(): Json {
  const inner: Json = { ok: true, n: 1.5 };

  return { list: [1, "two", null, inner], empty: {}, nested: [[[]]] };
}

/** A recursive union without null, and one that recurses through an object type's field. */
export type Tree = number | Tree[];
export type Node = string | { name: string; kids: Node[] };

export function sum(t: Tree): number {
  if (typeof t === "number") return t;

  let total = 0;

  for (const x of t) total += sum(x);

  return total;
}

export function names(n: Node): string {
  if (typeof n === "string") return n;

  return `${n.name}(${n.kids.map(names).join(",")})`;
}

export function grown(): Tree {
  const t: Tree[] = [1, [2, 3]];

  t.push([[4]]);

  return t;
}

/** Values kept in a map, compared, and handed to a callback and a promise. */
export function kept(entries: [string, Json][]): string {
  const m = new Map<string, Json>(entries);
  const a = m.get("a") ?? null;

  return `${m.size} ${a === null} ${m.get("n") === 2} ${m.get("s") === "x"}`;
}

export function visit(v: Json, f: (x: Json) => void): void {
  if (Array.isArray(v)) for (const x of v) f(x);
}

export async function later(v: Json): Promise<Json> {
  return [v, v];
}

/** What a task does with a value it is handed, and what equality and String() make of one. */
export async function counted(v: Json): Promise<number> {
  return await compute(depth, v);
}

export function described(v: Json): string {
  const list: Json[] = [v, v];

  return `${String(list[0])} ${list[0] === list[1]} ${list.includes(v)} ${new Set<Json>(list).size}`;
}
