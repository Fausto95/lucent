import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vite-plus/test";
import { compile } from "../../src/index.ts";
import { body, cppOf, inOrder, module, withLowering } from "./compile.ts";

const CASES = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../e2e/cases");

const SAMPLE = `interface Inner {
  c: number;
}
interface Outer {
  b: Inner;
  scale(by: number): number;
}
const log: string[] = [];
function next(n: number): number {
  log.push(String(n));
  return n;
}
export function scaled(o?: Outer): number | undefined {
  return o?.scale(next(2));
}
export function deep(o?: Outer): number | undefined {
  return o?.b.c;
}
export function element(xs: number[] | undefined, i: number): number | undefined {
  return xs?.[next(i)];
}
export function called(f?: (n: number) => number): number | undefined {
  return f?.(next(1));
}
`;

describe("optional chains in the IR", () => {
  it("runs the rest of a chain, its arguments included, only when the value is present", () => {
    const out = cppOf(module(SAMPLE), "ir-strict");

    for (const fn of ["scaled", "element", "called"])
      expect(inOrder(body(out, fn), "if (", "} else {", "m_sample::next(")).toBe(true);
  });

  it("reads past a ?. as on a present value", () => {
    const deep = body(cppOf(module(SAMPLE), "ir-strict"), "deep");

    expect(deep).toMatch(/->get_b\(\);\n.*->c;/);
  });

  it("compiles the optional-calls, objects and misc cases through the IR alone under ir-strict", () => {
    for (const name of ["optional-calls", "objects", "misc"]) {
      const r = withLowering("ir-strict", () => compile([path.join(CASES, `${name}.lucent.ts`)]));

      expect(r.diagnostics).toEqual([]);
    }
  });
});
