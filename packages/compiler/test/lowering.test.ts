import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { compile } from "../src/index.ts";
import { printIR } from "../src/ir/print.ts";
import { renderDiagnostic } from "../src/diagnostics/index.ts";
import { FIXTURES, expectGolden, fixtureNames, readFixture } from "./golden.ts";

describe("lowering (golden IR)", () => {
  for (const name of fixtureNames()) {
    test(name, () => {
      const { source, fileName } = readFixture(name);
      const result = compile(source, { fileName });
      expect(result.diagnostics.map((d) => renderDiagnostic(d, source, fileName)).join("\n")).toBe("");
      expect(result.module).not.toBeNull();
      expectGolden(printIR(result.module!), join(FIXTURES, `${name}.ir.txt`));
    });
  }
});

describe("diagnostics (golden output)", () => {
  const dir = join(FIXTURES, "diagnostics");
  for (const name of fixtureNames(dir)) {
    test(name, () => {
      const { source, fileName } = readFixture(name, dir);
      const result = compile(source, { fileName });
      expect(result.module).toBeNull();
      expect(result.diagnostics.length).toBeGreaterThan(0);
      const rendered = result.diagnostics.map((d) => renderDiagnostic(d, source, fileName)).join("\n\n") + "\n";
      expectGolden(rendered, join(dir, `${name}.diag.txt`));
    });
  }
});

const ir = (src: string) => {
  const r = compile(src, { fileName: "x.lucent.ts" });
  if (!r.module) throw new Error(r.diagnostics.map((d) => d.message).join("\n"));
  return printIR(r.module);
};

describe("lowering details", () => {
  test("shadowed locals get distinct ids", () => {
    const text = ir(`export function f(n: number): number { let x = n; if (n > 0) { let x = 1; n = x; } return x; }`);
    expect(text).toContain("%x");
    expect(text).toContain("%x.1");
  });

  test("compound assignment and update expand to plain assignment", () => {
    const text = ir(`export function f(): number { let i = 0; i += 2; i++; i--; return i; }`);
    expect(text).toContain("assign %i = (add %i 2)");
    expect(text).toContain("assign %i = (add %i 1)");
    expect(text).toContain("assign %i = (sub %i 1)");
  });

  test("template literals become string concatenation", () => {
    const text = ir("export function f(n: number, s: string): string { return `a${n}b${s}`; }");
    expect(text).toContain('(concat "a" (str n) "b" s)');
  });

  test("c-style for loops lower to while with the update at the end", () => {
    const text = ir(`export function f(): number { let t = 0; for (let i = 0; i < 3; i++) { t += i; } return t; }`);
    expect(text).toContain("while (lt %i 3)");
    expect(text).toMatch(/assign %t = \(add %t %i\)\n\s+assign %i = \(add %i 1\)/);
  });

  test("continue inside a c-style for loop is rejected", () => {
    const r = compile(`export function f(): number { for (let i = 0; i < 3; i++) { continue; } return 1; }`, {
      fileName: "x.lucent.ts",
    });
    expect(r.diagnostics.map((d) => d.code)).toEqual(["NT1001"]);
  });
});
