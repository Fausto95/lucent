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
});
