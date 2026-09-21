import { expect, test } from "vite-plus/test";
import { compile } from "../src/index.ts";

test("stdlib imports resolve to typed native operations", () => {
  const result = compile('import { abs, sqrt } from "@lucent-lang/std/math"; export function length(x: number): number { return sqrt(abs(x)); }', {fileName: "math.lucent.ts"});
  expect(result.diagnostics).toEqual([]);
  expect(result.module?.functions.some(f => f.binding)).toBe(true);
});
test("platform bindings record required capabilities", () => {
  const result = compile('import { now } from "@lucent-lang/platform/clock"; export function timestamp(): number { return now(); }', {fileName: "clock.lucent.ts"});
  expect(result.diagnostics).toEqual([]);
  expect(result.module?.capabilities).toContain("clock");
});
test("thread annotations survive lowering", () => {
  const result = compile('/** @thread main */ export async function f(): Promise<number> { return 1; }', {fileName: "main.lucent.ts"});
  expect(result.diagnostics).toEqual([]);
  expect(result.module?.functions[0]?.thread).toBe("main");
});
test("synchronous functions cannot request a thread hop", () => {
  const result = compile('/** @thread worker */ export function f(): number { return 1; }', {fileName: "main.lucent.ts"});
  expect(result.diagnostics.length).toBeGreaterThan(0);
});
