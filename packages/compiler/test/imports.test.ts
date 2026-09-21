import { describe, expect, test } from "vite-plus/test";
import { compile } from "../src/index.ts";

describe("Lucent module imports", () => {
  const sources = {
    "lib/math.lucent.ts": `function twice(x: number): number { return x * 2; }
      export function double(x: number): number { return twice(x); }
      export type Point = { x: number };`,
    "lib/view.lucent.tsx": `export function offset(x: number): number { return x + 1; }`,
  };
  test("links aliased functions and types across ts and tsx files", () => {
    const result = compile(
      `import { double as scale, type Point } from "./lib/math.lucent";
      import { offset } from "./lib/view.lucent.tsx";
      export function run(p: Point): number { return offset(scale(p.x)); }`,
      { fileName: "main.lucent.ts", sources },
    );
    expect(result.diagnostics).toEqual([]);
    expect(result.module?.functions.filter((f) => f.exported).map((f) => f.name)).toEqual(["run"]);
    expect(result.module?.functions).toHaveLength(4);
    expect(result.module?.structs).toHaveLength(1);
  });
  test("rejects missing exports and arbitrary JS dependencies", () => {
    for (const source of ["./lib/missing.lucent", "react"]) {
      expect(
        compile(`import { double } from "${source}";`, { fileName: "main.lucent.ts", sources }).diagnostics[0]?.code,
      ).toBe("NT1006");
    }
    expect(
      compile('import { twice } from "./lib/math.lucent";', { fileName: "main.lucent.ts", sources }).diagnostics[0]
        ?.code,
    ).toBe("NT1006");
  });
  test("rejects import cycles with a diagnostic", () => {
    const result = compile('import { b } from "./b.lucent"; export function a(): number { return b(); }', {
      fileName: "a.lucent.ts",
      sources: { "b.lucent.ts": 'import { a } from "./a.lucent"; export function b(): number { return a(); }' },
    });
    expect(result.diagnostics[0]?.code).toBe("NT1006");
    expect(result.diagnostics[0]?.message).toContain("cycle");
  });
  test("rejects a type-only import used as a value", () => {
    const result = compile(
      'import type { double } from "./lib/math.lucent"; export function f(): number { return double(1); }',
      { fileName: "main.lucent.ts", sources },
    );
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });
  test("does not expose dependency private names to the importer", () => {
    const result = compile(
      'import { double } from "./lib/math.lucent"; export function f(): number { return twice(1); }',
      { fileName: "main.lucent.ts", sources },
    );
    expect(result.diagnostics[0]?.code).toBe("NT1010");
  });
});

test("renders a dependency diagnostic against its own source", async () => {
  const { renderDiagnostic } = await import("../src/index.ts");
  const source = 'import { broken } from "./dep.lucent"; export function f(): number {return broken();}';
  const result = compile(source, {
    fileName: "root.lucent.ts",
    sources: { "dep.lucent.ts": 'export function broken(): number { return "bad"; }' },
  });
  const text = renderDiagnostic(result.diagnostics[0]!, source, "root.lucent.ts");
  expect(text).toContain("dep.lucent.ts");
  expect(text).toContain('return "bad"');
});
