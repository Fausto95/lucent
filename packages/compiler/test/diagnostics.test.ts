import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { compile } from "../src/index.ts";

function compileSource(source: string, name = "sample") {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lucent-diag-"));
  const file = path.join(dir, `${name}.lucent.ts`);
  fs.writeFileSync(file, source);
  return compile([file]);
}

function codes(source: string): string[] {
  return compileSource(source).diagnostics.map((d) => d.code);
}

describe("diagnostics", () => {
  it("accepts a simple module", () => {
    const r = compileSource("export function add(a: number, b: number): number { return a + b; }");
    expect(r.diagnostics).toEqual([]);
    expect(r.ok).toBe(true);
    expect([...r.files.keys()]).toContain("lucent_app.h");
  });

  it("accepts console", () => {
    expect(codes('export function f(n: number): void { console.log("n", n); console.warn(`w${n}`); }')).toEqual([]);
  });

  it("reports TypeScript errors first", () => {
    expect(codes("export function f(): number { return 'x'; }")).toEqual(["LUCENT9001"]);
  });

  it("rejects any", () => {
    expect(codes("export function f(x: any): number { return 1; }")).toContain("LUCENT2001");
  });

  it("rejects imports of other packages", () => {
    expect(codes('import fs from "node:fs";\nexport function f(): number { return 1; }')).toEqual(expect.arrayContaining([expect.stringMatching(/LUCENT(3001|9001)/)]));
  });

  it("rejects top-level statements", () => {
    expect(codes("export function f(): number { return 1; }\nf();")).toContain("LUCENT3002");
  });

  it("rejects var", () => {
    expect(codes("export function f(): number { var x = 1; return x; }")).toContain("LUCENT1001");
  });

  it("rejects throwing non-errors", () => {
    expect(codes('export function f(): number { throw "nope"; }')).toContain("LUCENT1006");
  });

  it("rejects inexact object types", () => {
    const src = `type A = { x: number }; type B = { x: number; y: number };
function take(a: A): number { return a.x; }
export function f(b: B): number { return take(b); }`;
    expect(codes(src)).toContain("LUCENT2003");
  });

  it("rejects exporting generic functions", () => {
    expect(codes("export function id<T>(x: T): T { return x; }")).toContain("LUCENT2007");
  });

  it("rejects ambiguous unions at the boundary", () => {
    const src = "type A = { a: number }; type B = { b: string };\nexport function f(x: A | B): number { return 1; }";
    expect(codes(src)).toContain("LUCENT2005");
  });

  it("rejects regular expressions", () => {
    expect(codes('export function f(s: string): boolean { return /a/.test(s); }').length).toBeGreaterThan(0);
  });

  it("rejects extending built-in classes other than Error", () => {
    const src = "class B extends Map<string, number> {}\nexport function f(): number { return new B().size; }";
    expect(codes(src)).toContain("LUCENT1005");
  });

  it("rejects overrides whose native signature differs", () => {
    const src = "class A { f(x: number): number { return x; } }\nclass B extends A { override f(x?: number): number { return 1; } }\nexport function g(): number { return new B().f(1); }";
    expect(codes(src)).toContain("LUCENT1005");
  });

  it("points at the source location", () => {
    const r = compileSource("export function f(): number {\n  var x = 1;\n  return x;\n}");
    const d = r.diagnostics.find((x) => x.code === "LUCENT1001");
    expect(d?.line).toBe(2);
  });

  describe("interfaces implemented by classes", () => {
    const shape = "interface Shape { area(): number; }\n";

    it("accepts a class that declares implements", () => {
      expect(codes(`${shape}class Sq implements Shape { area(): number { return 1; } }\nexport function f(): number { const s: Shape = new Sq(); return s.area(); }`)).toEqual([]);
    });

    it("rejects a class that matches only structurally", () => {
      expect(codes(`${shape}class Sq { area(): number { return 1; } }\nexport function f(): number { const s: Shape = new Sq(); return s.area(); }`)).toContain("LUCENT2008");
    });

    it("rejects an object literal for an interface with methods", () => {
      expect(codes(`${shape}export function f(): number { const s: Shape = { area: () => 1 }; return s.area(); }`)).toContain("LUCENT2008");
    });

    it("rejects a method whose native signature differs", () => {
      expect(codes(`interface P { at(i: number): string | undefined; }\nclass Q implements P { at(i?: number): string { return "x"; } }\nexport function f(): number { return 1; }`)).toContain("LUCENT2009");
    });

    it("rejects generic interfaces implemented by classes", () => {
      expect(codes(`interface Box<T> { get(): T; }\nclass N implements Box<number> { get(): number { return 1; } }\nexport function f(): number { return 1; }`)).toContain("LUCENT2009");
    });
  });

  describe("AbortSignal", () => {
    it("accepts signals from JavaScript", () => {
      expect(codes("export function f(s: AbortSignal): boolean { return s.aborted; }")).toEqual([]);
    });

    it("rejects returning a signal to JavaScript", () => {
      expect(codes("export function f(): AbortSignal { return new AbortController().signal; }")).toContain("LUCENT2006");
    });

    it("rejects abort reasons that are not errors", () => {
      expect(codes('export function f(): void { new AbortController().abort("stop"); }')).toContain("LUCENT1003");
    });

    it("rejects reading the untyped reason", () => {
      expect(codes("export function f(s: AbortSignal): boolean { return s.reason === undefined; }")).toEqual(expect.arrayContaining([expect.stringMatching(/LUCENT(1003|2001)/)]));
    });
  });

  describe("integer inference", () => {
    const hash = `export function hash(input: string, seed: number = 0): number {
  let h = seed | 0;
  for (let i = 0; i < input.length; i++) {
    h = Math.imul(h ^ input.charCodeAt(i), 0x5bd1e995);
    h ^= h >>> 15;
  }
  return h >>> 0;
}`;
    const cpp = (src: string) => compileSource(src).files.get("m_sample.cpp") ?? "";

    it("keeps int32 locals and loop counters in integer registers", () => {
      const out = cpp(hash);
      expect(out).toMatch(/int32_t h = /);
      expect(out).toMatch(/int64_t i = /);
    });

    it("leaves locals with fractional or non-bitwise writes as doubles", () => {
      const out = cpp("export function f(x: number): number {\n  let a = x | 0;\n  a += 1;\n  let z = 0;\n  z = -0;\n  return a + z;\n}");
      expect(out).toMatch(/double a = /);
      expect(out).toMatch(/double z = /);
    });
  });
});
