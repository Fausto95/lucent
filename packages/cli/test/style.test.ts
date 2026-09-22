import { describe, expect, test } from "vite-plus/test";
import { createPalette, supportsColor } from "../src/style.ts";

const ESC = String.fromCharCode(27);

describe("color support", () => {
  const cases: { name: string; env: Record<string, string>; isTTY: boolean; flag?: boolean; expected: boolean }[] = [
    { name: "a terminal gets color", env: {}, isTTY: true, expected: true },
    { name: "a pipe does not", env: {}, isTTY: false, expected: false },
    { name: "NO_COLOR wins over the terminal", env: { NO_COLOR: "1" }, isTTY: true, expected: false },
    { name: "FORCE_COLOR wins over a pipe", env: { FORCE_COLOR: "1" }, isTTY: false, expected: true },
    { name: "FORCE_COLOR wins over NO_COLOR", env: { FORCE_COLOR: "1", NO_COLOR: "1" }, isTTY: false, expected: true },
    { name: "FORCE_COLOR=0 disables", env: { FORCE_COLOR: "0" }, isTTY: true, expected: false },
    { name: "TERM=dumb disables", env: { TERM: "dumb" }, isTTY: true, expected: false },
    { name: "CI logs keep color", env: { CI: "true" }, isTTY: false, expected: true },
    { name: "--no-color beats everything", env: { FORCE_COLOR: "1" }, isTTY: true, flag: false, expected: false },
  ];
  for (const c of cases)
    test(c.name, () => {
      expect(supportsColor({ env: c.env, isTTY: c.isTTY, ...(c.flag === undefined ? {} : { flag: c.flag }) })).toBe(
        c.expected,
      );
    });
});

describe("palette", () => {
  test("wraps text in ANSI codes when enabled", () => {
    const p = createPalette(true);
    expect(p.red("x")).toBe(`${ESC}[31mx${ESC}[39m`);
    expect(p.bold("x")).toBe(`${ESC}[1mx${ESC}[22m`);
    expect(p.dim(p.cyan("x"))).toContain(`${ESC}[36m`);
  });
  test("returns text untouched when disabled", () => {
    const p = createPalette(false);
    for (const style of Object.values(p)) expect(style("plain")).toBe("plain");
  });
});
