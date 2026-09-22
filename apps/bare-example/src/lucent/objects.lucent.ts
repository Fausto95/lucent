export type Point = { x: number; y: number };
export interface Person {
  name: string;
  age: number;
  nickname?: string;
  tags: string[];
}

export function midpoint(a: Point, b: Point): Point {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

export function translate(p: Point, dx: number): Point {
  return { ...p, x: p.x + dx };
}

export function describe(p: Person): string {
  const nick = p.nickname ? ` aka ${p.nickname}` : "";
  return `${p.name}${nick} (${p.age}) [${p.tags.join(", ")}]`;
}

export function birthday(p: Person): Person {
  p.age += 1;
  p.tags.push("older");
  return p;
}

export function makePerson(name: string): Person {
  return { name, age: 0, tags: [] };
}

export function nickname(p: Person): string {
  return p.nickname?.toUpperCase() ?? "(none)";
}

export type Shape = { kind: "circle"; radius: number } | { kind: "rect"; w: number; h: number };

export function area(s: Shape): number {
  switch (s.kind) {
    case "circle":
      return Math.round(Math.PI * s.radius * s.radius * 100) / 100;
    case "rect":
      return s.w * s.h;
  }
}

export function shapes(n: number): Shape[] {
  const out: Shape[] = [];
  for (let i = 1; i <= n; i++) out.push(i % 2 ? { kind: "circle", radius: i } : { kind: "rect", w: i, h: 2 });
  return out;
}

export function parseValue(s: string): number | string | boolean {
  if (s === "true" || s === "false") return s === "true";
  const n = Number(s);
  return Number.isNaN(n) ? s : n;
}

export function kindOf(v: number | string | boolean): string {
  if (typeof v === "number") return `number:${v + 1}`;
  if (typeof v === "string") return `string:${v.length}`;
  return `boolean:${!v}`;
}

export function maybe(v: number | undefined | null): string {
  if (v === undefined) return "undefined";
  if (v === null) return "null";
  return `value ${v * 2}`;
}

export type Tree = { value: number; children: Tree[] };

export function treeSum(t: Tree): number {
  let s = t.value;
  for (const c of t.children) s += treeSum(c);
  return s;
}

export function tree(depth: number): Tree {
  const node: Tree = { value: depth, children: [] };
  if (depth > 0) {
    node.children.push(tree(depth - 1));
    node.children.push(tree(depth - 1));
  }
  return node;
}

export function pairs(xs: number[]): [number, string][] {
  return xs.map((x) => [x, `#${x}`]);
}

export function swap(p: [string, number]): [number, string] {
  const [a, b] = p;
  return [b, a];
}

export function destructure(p: Person): string {
  const { name, age: years, nickname = "nick?" } = p;
  const [firstTag = "none", ...rest] = p.tags;
  return `${name} ${years} ${nickname} ${firstTag} ${rest.length}`;
}

export function toJson(p: Person, s: Shape): string {
  return JSON.stringify(p) + " " + JSON.stringify(s) + " " + JSON.stringify([1, "two", null]) + " " + JSON.stringify("q\"\n");
}
