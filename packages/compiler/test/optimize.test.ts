import { describe, expect, test } from "vite-plus/test";
import { compile, optimizeModule, printIR, validateHIR, type IRModule } from "../src/index.ts";
import { T } from "../src/types/native-type.ts";

function exportedFunctionNames(module: IRModule): string[] {
  return module.functions
    .filter((f) => f.exported)
    .map((f) => f.name)
    .toSorted();
}

describe("optimizeModule", () => {
  test("constant-folds numeric binary ops when optimize is enabled", () => {
    const off = compile(`export function f(): number { return 1 + 2; }`, {
      fileName: "fold.lucent.ts",
    });
    expect(off.diagnostics).toEqual([]);
    expect(printIR(off.module!)).toContain("(add 1 2)");

    const on = compile(`export function f(): number { return 1 + 2; }`, {
      fileName: "fold.lucent.ts",
      optimize: true,
    });
    expect(on.diagnostics).toEqual([]);
    expect(printIR(on.module!)).toContain("return 3");
    expect(printIR(on.module!)).not.toContain("(add 1 2)");
    expect(on.optimizeLog?.some((l) => l.startsWith("constant-fold:"))).toBe(true);
    expect(validateHIR(on.module!)).toEqual([]);
  });

  test("folds sub and mul", () => {
    const result = compile(
      `export function f(): number { return 10 - 3; }
export function g(): number { return 4 * 5; }`,
      { fileName: "ops.lucent.ts", optimize: true },
    );
    expect(result.diagnostics).toEqual([]);
    const text = printIR(result.module!);
    expect(text).toContain("return 7");
    expect(text).toContain("return 20");
  });

  test("dead-code eliminates pure const expr statements", () => {
    const off = compile(`export function f(): number { 42; return 1; }`, {
      fileName: "dce.lucent.ts",
    });
    expect(printIR(off.module!)).toContain("42");

    const on = compile(`export function f(): number { 42; return 1; }`, {
      fileName: "dce.lucent.ts",
      optimize: true,
    });
    expect(on.diagnostics).toEqual([]);
    const text = printIR(on.module!);
    expect(text).not.toMatch(/^\s*42\s*$/m);
    expect(text).toContain("return 1");
    expect(on.optimizeLog?.some((l) => l.startsWith("dce:"))).toBe(true);
    expect(validateHIR(on.module!)).toEqual([]);
  });

  test("dead-branch eliminates if (true) / if (false) after const fold", () => {
    const source = `export function f(): number {
  if (false) { return 1; } else { return 2; }
}
export function g(): number {
  return true ? 3 : 4;
}`;
    const on = compile(source, { fileName: "branch.lucent.ts", optimize: true });
    expect(on.diagnostics).toEqual([]);
    const text = printIR(on.module!);
    expect(text).toContain("return 2");
    expect(text).not.toContain("return 1");
    expect(text).toContain("return 3");
    expect(text).not.toContain("return 4");
    expect(on.optimizeLog?.some((l) => l.startsWith("dead-branch:") && l.includes("eliminated"))).toBe(true);
    expect(validateHIR(on.module!)).toEqual([]);
  });

  test("leaves the module unchanged when optimize is off", () => {
    const result = compile(`export function f(): number { return 1 + 2; }`, {
      fileName: "off.lucent.ts",
    });
    expect(result.optimizeLog).toBeUndefined();
    expect(printIR(result.module!)).toContain("(add 1 2)");
  });

  test("escape-analysis tags returned locals as Escape", () => {
    const result = compile(`export function f(): number { const x = 1; const y = 2; return x; }`, {
      fileName: "escape.lucent.ts",
      optimize: true,
    });
    expect(result.diagnostics).toEqual([]);
    expect(result.optimizeLog?.some((l) => l.includes("escape-analysis:") && l.includes("Escape"))).toBe(true);
    expect(result.optimizeLog?.some((l) => l.includes("escape-analysis:") && l.includes("NoEscape"))).toBe(true);
  });

  test("reachability removes unreachable non-exported functions", () => {
    const result = compile(
      `function dead(): number { return 1; }
export function live(): number { return 2; }`,
      { fileName: "reach.lucent.ts", optimize: true },
    );
    expect(result.diagnostics).toEqual([]);
    expect(result.optimizeLog?.some((l) => l.includes("reachability: removed") && l.includes("dead"))).toBe(true);
    expect(printIR(result.module!)).not.toContain("fn dead");
    expect(printIR(result.module!)).toContain("fn live");
  });

  test("optimize on/off keeps the same exported function set", () => {
    const source = `function helper(): number { return 1; }
function dead(): number { return 9; }
export function live(): number { return helper(); }
export function other(): number { return 3; }`;
    const off = compile(source, { fileName: "diff.lucent.ts" });
    const on = compile(source, { fileName: "diff.lucent.ts", optimize: true });
    expect(off.diagnostics).toEqual([]);
    expect(on.diagnostics).toEqual([]);
    expect(exportedFunctionNames(on.module!)).toEqual(exportedFunctionNames(off.module!));
    expect(on.module!.functions.some((f) => f.name === "dead")).toBe(false);
    expect(off.module!.functions.some((f) => f.name === "dead")).toBe(true);
    expect(on.module!.functions.some((f) => f.name === "helper")).toBe(true);
    expect(validateHIR(on.module!)).toEqual([]);
  });

  test("rolls back a pass when validateHIR fails after rewrite", () => {
    const broken: IRModule = {
      name: "broken",
      structs: [],
      functions: [
        {
          name: "f",
          exported: true,
          async: false,
          params: [],
          returnType: T.float64,
          locals: [],
          body: [
            {
              op: "return",
              value: {
                op: "call",
                callee: "poison",
                args: [{ op: "const", value: 1, type: T.float64 }],
                semantics: {
                  // Mismatched ownership length → validateHIR error
                  argumentOwnership: [],
                  resultOwnership: "value",
                  effects: { async: false, throws: false, native: false },
                  suspension: false,
                  cancellation: "none",
                },
                type: T.float64,
              },
            },
          ],
        },
      ],
    };
    expect(validateHIR(broken).length).toBeGreaterThan(0);
    const result = optimizeModule(broken, { enabled: true });
    expect(result.module).toBe(broken);
    expect(result.log.filter((l) => l.includes("validation failed")).length).toBeGreaterThanOrEqual(2);
  });
});
