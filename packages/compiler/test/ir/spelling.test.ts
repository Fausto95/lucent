import { describe, expect, it } from "vite-plus/test";
import { body, cppOf, module } from "./compile.ts";

const SAMPLE = `function text(n: number): string {
  let s = "";
  for (let i = 0; i < n; i++) s += String.fromCharCode(97 + (i % 26));
  return s;
}
export function hash(n: number): number {
  const input = text(n);
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h;
}
function nothing(): null {
  return null;
}
function show(v: string | null): string {
  return v ?? "null";
}
export function shown(): string {
  return show(nothing());
}
`;

describe("the IR's C++", () => {
  it("reads a local where it is used, without copying it", () => {
    const hash = body(cppOf(module(SAMPLE)), "hash");

    expect(hash).toContain("input.charCodeAt(");

    expect(hash).not.toMatch(/lucent::String v\d+_ = input;/);
  });

  it("appends to a string in place", () => {
    expect(body(cppOf(module(SAMPLE)), "text")).toMatch(/^ +s \+= /m);
  });

  it("keeps exact integers in integer registers", () => {
    const hash = body(cppOf(module(SAMPLE)), "hash");

    expect(hash).toContain("int64_t h = ");

    expect(hash).toContain("int64_t i = ");

    expect(hash).toMatch(/static_cast<uint32_t>\(h\) \* static_cast<uint32_t>\(16777619\)/);

    expect(hash).not.toContain("lucent::jsXor");
  });

  it("still runs a call whose absent value its conversion does not read", () => {
    const shown = body(cppOf(module(SAMPLE)), "shown");

    expect(shown).toContain("lucent_app::m_sample::nothing()");

    expect(shown).toContain("lucent::Opt<lucent::String>(lucent::null)");
  });

  it("reads a loop's element where its array holds it, when the body only reads", () => {
    const file = module(`interface Point {
  x: number;
  y: number;
}
export function sum(points: Point[], names: string[], xs: number[]): number {
  let s = 0;
  for (const p of points) s += p.x + p.y;
  for (const name of names) s += name.length;
  for (const x of xs) s += x;
  return s;
}
`);
    const sum = body(cppOf(file), "sum");

    expect(sum).toMatch(/const auto& v\d+_ = coll\d+_\.items\(\)\[i\d+_\];\n.*\n\s+const auto& p = /);

    expect(sum).toMatch(/const auto& name = v\d+_;/);

    expect(sum).toMatch(/double x = v\d+_;/);
  });

  it("moves a loop's element into the body's variable when the body may change the array", () => {
    const file = module(`interface Point {
  x: number;
}
function grow(points: Point[]): void {
  points.push({ x: 0 });
}
export function sum(points: Point[], names: string[]): number {
  let s = 0;
  for (const p of points) {
    grow(points);
    s += p.x;
  }
  for (const name of names) {
    names[0] = "x";
    s += name.length;
  }
  return s;
}
`);
    const sum = body(cppOf(file), "sum");

    expect(sum).toMatch(/lucent::Ref<lucent_app::S_Point> p = std::move\(v\d+_\);/);

    expect(sum).toMatch(/lucent::String name = std::move\(v\d+_\);/);

    expect(sum).not.toContain("items()[");
  });

  it("reads a map's entries in place, copying neither an unused key nor a value", () => {
    const file = module(`export function total(m: Map<string, number>, r: Record<string, string>): number {
  let s = 0;
  for (const [, v] of m) s += v;
  for (const [k] of m) s += k.length;
  for (const [k, v] of Object.entries(r)) s += k.length + v.length;
  return s;
}
`);
    const total = body(cppOf(file), "total");

    expect(total).toContain("std::tuple<const lucent::String&, const double&>(");

    expect(total).not.toContain("std::tuple<lucent::String, double> v");
  });

  it("copies a value an inner loop declares, as each of its runs needs it", () => {
    const file = module(`export function rows(names: string[], n: number): number {
  let s = 0;
  for (const name of names) {
    for (let i = 0; i < n; i++) {
      const again = name;
      s += again.length;
    }
  }
  return s;
}
`);

    expect(body(cppOf(file), "rows")).toMatch(/lucent::String again = name;/);
  });
});
