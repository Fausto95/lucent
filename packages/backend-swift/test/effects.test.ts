import { expect, test } from "vite-plus/test";
import { compile } from "@lucent-lang/compiler";
import { generateSwift } from "../src/index.ts";

/**
 * Swift forbids an unmarked throwing call, so every statement whose expression
 * reaches one must carry `try`. Nested expression forms are the easy ones to
 * miss: the analysis has to descend through them, not just through operators.
 */
const swiftFor = (source: string): string =>
  generateSwift(compile(source, { fileName: "effects.lucent.ts" }).module!).code;

const CALLEE = "function pick(value: number): number { return value * 2; }";

test("marks a call inside a conditional expression", () => {
  const code = swiftFor(`${CALLEE} export function choose(flag: boolean): number { return flag ? pick(1) : pick(2); }`);
  expect(code).toContain("return try flag ? pick(value: 1.0) : pick(value: 2.0)");
});

test("marks a call inside a nested conditional expression", () => {
  const code = swiftFor(
    `${CALLEE} export function nested(a: boolean, b: boolean): number { return a ? 1 : b ? pick(2) : 3; }`,
  );
  expect(code).toContain("return try ");
});

test("marks a conditional bound to a local", () => {
  const code = swiftFor(
    `${CALLEE} export function bind(flag: boolean): number { const value = flag ? pick(1) : 0; return value; }`,
  );
  expect(code).toContain("let value: Double = try ");
});
