import { describe, expect, test } from "vite-plus/test";
import { compile, renderDiagnostic } from "@lucent-lang/compiler";
import { colorizeDiagnostic, positionOf } from "../src/diagnostics.ts";
import { createPalette } from "../src/style.ts";

const ESC = String.fromCharCode(27);
const ANSI = new RegExp(`${ESC}\\[\\d+m`, "g");
const source = "export function f(x: any): number { return 1; }\n";
const rendered = renderDiagnostic(
  compile(source, { fileName: "bad.lucent.ts" }).diagnostics[0]!,
  source,
  "bad.lucent.ts",
);

describe("colorizeDiagnostic", () => {
  test("is the identity without color", () => {
    expect(colorizeDiagnostic(rendered, createPalette(false))).toBe(rendered);
  });
  test("paints severity, location and carets", () => {
    const out = colorizeDiagnostic(rendered, createPalette(true));
    expect(out).toContain(`${ESC}[31merror${ESC}[39m`);
    expect(out).toContain(`${ESC}[36mbad.lucent.ts:1:`);
    expect(out).toMatch(/\[31m\^+/);
    expect(out.replaceAll(ANSI, "")).toBe(rendered);
  });
  test("paints warnings yellow", () => {
    const out = colorizeDiagnostic("warning LUCENT3002: Potentially expensive main-thread work", createPalette(true));
    expect(out).toContain(`${ESC}[33mwarning${ESC}[39m`);
  });
});

test("positionOf maps offsets to 1-based line and column", () => {
  expect(positionOf("ab\ncd\n", 0)).toEqual({ line: 1, column: 1 });
  expect(positionOf("ab\ncd\n", 4)).toEqual({ line: 2, column: 2 });
});
