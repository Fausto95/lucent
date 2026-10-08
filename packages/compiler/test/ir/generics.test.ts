import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vite-plus/test";
import { compile } from "../../src/index.ts";
import { module } from "./compile.ts";

const CASES = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../e2e/cases");

describe("generic functions in the IR", () => {
  it("lowers a generic function to a template its callers instantiate", () => {
    const file = module(`function pick<T>(xs: T[], fallback: T): T {
  let best = fallback;
  for (const x of xs) best = x;
  return best;
}
export function last(xs: number[]): number {
  return pick(xs, -1);
}
`);
    const r = compile([file]);

    expect(r.diagnostics).toEqual([]);

    const header = r.files.get("m_sample.h")!.replace(/^#line .*\n/gm, "");

    expect(header).toContain(
      ["template <class T>", "T pick(lucent::Array<T> p0_, T p1_) {", "  T best = p1_;"].join("\n"),
    );

    expect(r.files.get("m_sample.cpp")).toContain("lucent_app::m_sample::pick<double>(p0_, ");
  });

  it("compiles the generics, union-generics and function-values cases without a diagnostic", () => {
    for (const name of ["generics", "union-generics", "function-values"]) {
      const r = compile([path.join(CASES, `${name}.lucent.ts`)]);

      expect(r.diagnostics).toEqual([]);
    }
  });

  it("tests a type parameter's value for null or undefined in ?? and ??=", () => {
    const file = module(`function or<T>(x: T, d: T): T {
  return x ?? d;
}
function fill<T>(x: T, d: T): T {
  let v = x;
  v ??= d;
  return v;
}
export function use(): string {
  return \`\${or<number | undefined>(undefined, 1)} \${fill<number | undefined>(undefined, 2)}\`;
}
`);
    const r = compile([file]);

    expect(r.diagnostics).toEqual([]);

    const header = r.files.get("m_sample.h")!.replace(/^#line .*\n/gm, "");

    expect(header).toContain("lucent::looseEqualsNull(p0_)");

    expect(header).not.toMatch(/T or\(T p0_, T p1_\) \{\n  return p0_;/);
  });
});
