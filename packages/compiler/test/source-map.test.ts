import { describe, expect, test } from "vite-plus/test";
import { compile } from "../src/index.ts";

describe("sourceMap option", () => {
  test("emits lucent.map.json-shaped mappings for IR functions", () => {
    const source = `function helper(): number { return 1; }
export function live(): number { return helper(); }`;
    const result = compile(source, { fileName: "map.lucent.ts", sourceMap: true });
    expect(result.diagnostics).toEqual([]);
    expect(result.sourceMap).toEqual({
      version: 1,
      fileName: "map.lucent.ts",
      functions: expect.arrayContaining([
        expect.objectContaining({ name: "helper", start: expect.any(Number), end: expect.any(Number) }),
        expect.objectContaining({ name: "live", start: expect.any(Number), end: expect.any(Number) }),
      ]),
    });
    for (const fn of result.sourceMap!.functions) {
      expect(fn.end).toBeGreaterThan(fn.start);
      expect(source.slice(fn.start, fn.end)).toContain(fn.name);
    }
  });

  test("omits sourceMap when the option is off", () => {
    const result = compile(`export function f(): number { return 1; }`, { fileName: "off.lucent.ts" });
    expect(result.sourceMap).toBeUndefined();
  });

  test("source map only lists functions that remain after optimize", () => {
    const source = `function dead(): number { return 1; }
export function live(): number { return 2; }`;
    const result = compile(source, { fileName: "opt-map.lucent.ts", optimize: true, sourceMap: true });
    expect(result.diagnostics).toEqual([]);
    const names = result.sourceMap!.functions.map((f) => f.name);
    expect(names).toContain("live");
    expect(names).not.toContain("dead");
  });
});
