import { expect, test } from "vite-plus/test";
import { compile } from "../src/index.ts";

test("stdlib imports resolve to typed native operations", () => {
  const result = compile(
    'import { abs, sqrt } from "@lucent-lang/core/math"; export function length(x: number): number { return sqrt(abs(x)); }',
    { fileName: "math.lucent.ts" },
  );
  expect(result.diagnostics).toEqual([]);
  expect(result.module?.functions.some((f) => f.binding)).toBe(true);
});
test("platform bindings record required capabilities", () => {
  const result = compile(
    'import { now } from "@lucent-lang/platform/clock"; export function timestamp(): number { return now(); }',
    { fileName: "clock.lucent.ts" },
  );
  expect(result.diagnostics).toEqual([]);
  expect(result.module?.capabilities).toContain("clock");
});
test("thread annotations survive lowering", () => {
  const result = compile("@MainThread export async function f(): Promise<number> { return 1; }", {
    fileName: "main.lucent.ts",
  });
  expect(result.diagnostics).toEqual([]);
  expect(result.module?.functions[0]?.thread).toBe("main");
});
test("synchronous functions cannot request a thread hop", () => {
  const result = compile("@Background export function f(): number { return 1; }", {
    fileName: "main.lucent.ts",
  });
  expect(result.diagnostics.length).toBeGreaterThan(0);
});

test("async SDK declarations infer suspension from Promise", () => {
  const result = compile(
    'import {model} from "@lucent-lang/platform/device"; export async function f():Promise<string>{return await model();}',
    {
      fileName: "device.lucent.ts",
      libraries: {
        "@lucent-lang/platform/device": {
          source: "export declare function model():Promise<string>;",
          bindings: { model: { swift: ['return "phone"'], kotlin: ['return "phone"'], thread: "main" } },
        },
      },
    },
  );
  expect(result.diagnostics).toEqual([]);
  expect(result.module?.functions.find((f) => f.binding)?.async).toBe(true);
});

test("only requires capabilities of reachable SDK functions", () => {
  const result = compile(
    'import {read} from "@lucent-lang/platform/demo"; export function f():number{return read();}',
    {
      fileName: "demo.lucent.ts",
      libraries: {
        "@lucent-lang/platform/demo": {
          source: "export declare function read():number; export declare function unused():number;",
          bindings: {
            read: { swift: ["return 1"], kotlin: ["return 1.0"], capabilities: ["read"] },
            unused: { swift: ["return 2"], kotlin: ["return 2.0"], capabilities: ["unused"] },
          },
        },
      },
    },
  );
  expect(result.module?.capabilities).toEqual(["read"]);
});
