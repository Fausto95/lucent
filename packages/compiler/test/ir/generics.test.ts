import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vite-plus/test";
import { compile } from "../../src/index.ts";
import { module, withLowering } from "./compile.ts";

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
    const r = withLowering("ir-strict", () => compile([file]));

    expect(r.diagnostics).toEqual([]);

    const header = r.files.get("m_sample.h")!.replace(/^#line .*\n/gm, "");

    expect(header).toContain(
      ["template <class T>", "T pick(lucent::Array<T> p0_, T p1_) {", "  T best = p1_;"].join("\n"),
    );

    expect(r.files.get("m_sample.cpp")).toContain("lucent_app::m_sample::pick<double>(p0_, ");
  });

  it("compiles the generics, union-generics and function-values cases through the IR alone under ir-strict", () => {
    for (const name of ["generics", "union-generics", "function-values"]) {
      const r = withLowering("ir-strict", () => compile([path.join(CASES, `${name}.lucent.ts`)]));

      expect(r.diagnostics).toEqual([]);
    }
  });
});
