import { describe, expect, test } from "vite-plus/test";
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

const compiled = (src: string) => {
  const r = compile(src, { fileName: "x.lucent.ts" });
  if (!r.module) throw new Error(r.diagnostics.map((d) => d.message).join("\n"));
  return r.module;
};

const ir = (src: string) => printIR(compiled(src));

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
    expect(r.diagnostics.map((d) => d.code)).toEqual(["LUCENT1001"]);
  });
});

/**
 * Swift and Kotlin parameters are immutable bindings, so a parameter mutated in
 * place normally needs a `var` shadow. A reference struct does not: it becomes a
 * `final class` / `class`, and writing through the reference is legal on a `let`.
 * The shadow there is noise that also shadows the parameter's own name.
 */
describe("parameter shadows", () => {
  const CLASS = `export class Counter {
    value: number = 0;
    constructor(initial: number) { this.value = initial; }
    increment(delta: number): number { this.value += delta; return this.value; }
  }`;

  test("a mutated reference receiver uses the parameter directly", () => {
    const text = ir(CLASS);
    expect(text).not.toMatch(/let %lucentSelf: struct \S+ = lucentSelf/);
    expect(text).toContain("assign (field lucentSelf value) = (add (field lucentSelf value) delta)");
    expect(text).toContain("assign (field lucentSelf value) = value");
  });

  test("a constructor still binds its own receiver", () => {
    // `__create` builds the instance from a struct literal; that local is real.
    expect(ir(CLASS)).toMatch(/let %lucentSelf: struct \S+ = \(struct \S+ \(value 0\)\)/);
  });

  test("a reference local written through stays immutable", () => {
    // A `var` that is never reassigned draws a swiftc warning, and assigning a
    // field of a class reference does not reassign the binding.
    const create = compiled(CLASS).functions.find((f) => f.name.endsWith("__create"))!;
    expect(create.locals.map((l) => [l.name, l.mutable])).toEqual([["lucentSelf", false]]);
  });

  test("a value-struct local written through becomes mutable", () => {
    const make = compiled(`type P = { x: number };
      export function make(): P { const p: P = { x: 0 }; p.x = 1; return p; }`).functions[0]!;
    expect(make.locals.map((l) => [l.name, l.mutable])).toEqual([["p", true]]);
  });

  test("a rebound reference parameter keeps its shadow", () => {
    const text = ir(`${CLASS}
      export function swap(a: Counter, b: Counter): number { a = b; return a.value; }`);
    expect(text).toMatch(/let %a: struct \S+ = a/);
  });

  test("a mutated value struct keeps its shadow", () => {
    const text = ir(`type P = { x: number };
      export function move(p: P): void { p.x = 1; }`);
    expect(text).toContain("let %p: struct P = p");
  });

  test("a mutated array keeps its shadow", () => {
    const text = ir("export function add(xs: number[], v: number): void { xs.push(v); }");
    expect(text).toContain("let %xs: array<float64> = xs");
  });

  test("a rebound scalar keeps its shadow", () => {
    const text = ir("export function bump(n: number): number { n = n + 1; return n; }");
    expect(text).toContain("let %n: float64 = n");
  });
});
