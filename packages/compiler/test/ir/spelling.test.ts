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

  it("moves a loop's element into the variable the body declares, without copying it", () => {
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

    expect(sum).toMatch(/lucent::Ref<lucent_app::S_Point> p = std::move\(v\d+_\);/);

    expect(sum).toMatch(/lucent::String name = std::move\(v\d+_\);/);

    expect(sum).toMatch(/double x = v\d+_;/);
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

    expect(body(cppOf(file), "rows")).not.toContain("std::move");
  });
});
