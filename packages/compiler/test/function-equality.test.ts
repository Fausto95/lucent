import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vite-plus/test";
import { compile } from "../src/index.ts";

const PRELUDE = `
type F = (x: number) => number;

function named(x: number): number {
  return x;
}

function same<T>(a: T, b: T): boolean {
  return a === b;
}

function first<T>(xs: T[]): T | undefined {
  return xs[0];
}
`;

function diagnostics(body: string) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lucent-fn-eq-"));
  const file = path.join(dir, "sample.lucent.ts");

  fs.writeFileSync(file, `${PRELUDE}\n${body}`);

  return compile([file]).diagnostics.map((d) => ({ code: d.code, message: d.message }));
}

const rejected = (code: string) => [
  { code, message: expect.stringContaining("functions cannot be compared") },
];

// Function values have no stable identity in Lucent (a named function is a
// new value at each use), so every comparison of two functions is refused,
// rather than compiled to C++ that cannot build.
describe("comparing functions", () => {
  it("rejects === and !== between functions", () => {
    expect(
      diagnostics("export function f(): boolean { const g: F = named; return g === named; }"),
    ).toEqual(rejected("LUCENT1002"));

    expect(
      diagnostics(
        "export function f(): boolean { const g: F = named; const h: F = named; return g !== h; }",
      ),
    ).toEqual(rejected("LUCENT1002"));
  });

  it("rejects a switch over functions, whose cases compare with ===", () => {
    expect(
      diagnostics(
        "export function f(g: F): number { switch (g) { case named: return 1; } return 0; }",
      ),
    ).toEqual(rejected("LUCENT1002"));
  });

  it("rejects comparing optional functions and tuples holding functions", () => {
    expect(
      diagnostics(
        "export function f(flag: boolean): boolean { const g: F | undefined = flag ? named : undefined; const h: F = named; return g === h; }",
      ),
    ).toEqual(rejected("LUCENT1002"));

    expect(
      diagnostics(
        "export function f(): boolean { const a: [F, number] = [named, 1]; const b: [F, number] = [named, 1]; return a === b; }",
      ),
    ).toEqual(rejected("LUCENT1002"));
  });

  it("accepts comparing a function with an absent value or another type", () => {
    expect(
      diagnostics(
        "export function f(flag: boolean): boolean { const g: F | undefined = flag ? named : undefined; return g === undefined; }",
      ),
    ).toEqual([]);

    expect(
      diagnostics(
        'export function f(flag: boolean): boolean { const g: F | string = flag ? named : "x"; return g === "x"; }',
      ),
    ).toEqual([]);
  });

  it("rejects searching an array of functions", () => {
    for (const method of ["indexOf", "lastIndexOf", "includes"])
      expect(
        diagnostics(
          `export function f(): string { const g: F = named; const fs: F[] = [g]; return String(fs.${method}(g)); }`,
        ),
      ).toEqual(rejected("LUCENT1002"));
  });

  it("rejects maps and sets keyed by functions", () => {
    expect(
      diagnostics("export function f(): number { const m = new Map<F, number>(); return m.size; }"),
    ).toEqual(rejected("LUCENT2002"));

    expect(
      diagnostics("export function f(): number { const s = new Set<F>(); return s.size; }"),
    ).toEqual(rejected("LUCENT2002"));

    expect(
      diagnostics("export function f(): number { const m = new Map<string, F>(); return m.size; }"),
    ).toEqual([]);
  });

  it("rejects a generic that compares its type parameter, called with functions", () => {
    expect(
      diagnostics("export function f(): boolean { const g: F = named; return same(g, g); }"),
    ).toEqual(rejected("LUCENT1002"));

    expect(
      diagnostics(`
function outer<U>(a: U, b: U): boolean {
  return same(a, b);
}

export function f(): boolean {
  const g: F = named;
  return outer<F>(g, g);
}`),
    ).toEqual(rejected("LUCENT1002"));
  });

  it("accepts generics that compare other types, or do not compare", () => {
    expect(diagnostics("export function f(): boolean { return same(1, 2); }")).toEqual([]);

    expect(
      diagnostics(
        "export function f(): number { const g: F = named; const h = first([g]); return h ? h(1) : 0; }",
      ),
    ).toEqual([]);
  });

  it("rejects a generic class that compares its type parameter, made with functions", () => {
    const bag = `
class Bag<T> {
  items: T[] = [];

  has(x: T): boolean {
    return this.items.includes(x);
  }
}
`;

    expect(
      diagnostics(
        `${bag}\nexport function f(): boolean { const b = new Bag<F>(); return b.items.length > 0; }`,
      ),
    ).toEqual(rejected("LUCENT1002"));

    expect(
      diagnostics(
        `${bag}\nexport function f(): boolean { const b = new Bag<number>(); return b.has(1); }`,
      ),
    ).toEqual([]);
  });
});
