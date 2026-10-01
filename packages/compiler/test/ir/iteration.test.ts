import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vite-plus/test";
import { compile } from "../../src/index.ts";
import { body, cppOf, module, withLowering } from "./compile.ts";

const CASES = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../e2e/cases");

describe("for … of and for … in in the IR", () => {
  it("goes over an array with a counter, giving the body each element", () => {
    const file = module(`export function sum(xs: number[]): number {
  let total = 0;
  for (const x of xs) total += x;
  return total;
}
`);
    const sum = body(cppOf(file, "ir-strict"), "sum");

    expect(sum).toContain("for (size_t i0_ = 0; i0_ < coll0_.size(); i0_++) {");

    expect(sum).toMatch(/double v\d+_ = coll0_\.at\(i0_\);/);
  });

  it("goes over a map's entries, a set's elements and a string's code points", () => {
    const file =
      module(`export function walk(m: Map<string, number>, tags: Set<string>, s: string): string {
  const out: string[] = [];
  for (const [k, v] of m) out.push(k + v);
  for (const t of tags) out.push(t);
  for (const c of s) out.push(c);
  return out.join(",");
}
`);
    const walk = body(cppOf(file, "ir-strict"), "walk");

    expect(walk).toContain("std::tuple<lucent::String, double>(");

    expect(walk).toContain(".slotLive(");

    expect(walk).toContain("lucent::splitCodePoints(");
  });

  it("jumps out of a labeled for … of from an inner loop", () => {
    const file = module(`export function find(rows: number[][], n: number): number {
  let seen = 0;
  outer: for (const row of rows) {
    for (const x of row) {
      if (x === n) break outer;
      if (x < 0) continue outer;
      seen++;
    }
  }
  return seen;
}
`);
    const find = body(cppOf(file, "ir-strict"), "find");

    expect(find).toContain("goto brk0_;");

    expect(find).toContain("goto cont0_;");
  });

  it("goes over a record's keys with for … in", () => {
    const file = module(`export function keys(r: Record<string, number>): string {
  let out = "";
  for (const k in r) out += k;
  return out;
}
`);
    const keys = body(cppOf(file, "ir-strict"), "keys");

    expect(keys).toContain(".keys()");
  });

  it("destructures declarations, parameters and loop heads, defaults filling undefined parts", () => {
    const file = module(`interface P {
  x: number;
  y: number;
}
function norm({ x, y }: P): number {
  return x * x + y * y;
}
export function run(xs: number[], ps: P[]): number {
  const [a, b = 2] = xs;
  let total = a ?? 0;
  for (const { x, y: z } of ps) total += x + z + norm({ x, y: z });
  return total + b;
}
`);
    const out = cppOf(file, "ir-strict");

    expect(body(out, "run")).toContain(".get(1.0)");

    expect(body(out, "norm")).toContain("double x = p0_->x;");
  });

  it("assigns to the targets of a destructuring assignment in order", () => {
    const file = module(`export function swap(a: number, b: number): string {
  [a, b] = [b, a];
  return \`\${a} \${b}\`;
}
`);

    expect(body(cppOf(file, "ir-strict"), "swap")).toMatch(
      /a = std::get<0>\((v\d+_)\);\n\s*b = std::get<1>\(\1\);/,
    );
  });

  it("compiles the strings, numbers and kernels cases through the IR alone under ir-strict", () => {
    for (const name of ["strings", "numbers", "kernels"]) {
      const r = withLowering("ir-strict", () => compile([path.join(CASES, `${name}.lucent.ts`)]));

      expect(r.diagnostics).toEqual([]);
    }
  });
});
