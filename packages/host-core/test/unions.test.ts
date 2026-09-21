import { expect, test } from "vite-plus/test";
import { compile } from "@lucent-lang/compiler";
import { convert, declarations, type ConversionPolicy } from "../src/index.ts";
const module = compile(
  'export type State = { kind: "idle" } | { kind: "ready"; value: number }; export function echo(s: State): State { return s; }',
  { fileName: "state.lucent.ts" },
).module!;
test("union declarations preserve the public discriminated shape", () => {
  const dts = declarations(module);
  expect(dts).toContain('kind: "idle"');
  expect(dts).toContain('kind: "ready"');
});
test.each([false, true])("union boundary conversions validate and project variants (nitro=%s)", (nullAsUndefined) => {
  const policy: ConversionPolicy = { structs: new Map(module.structs.map((s) => [s.name, s])), nullAsUndefined };
  const toNative = new Function("value", "return " + convert("value", { kind: "struct", name: "State" }, "in", policy));
  const toJS = new Function("value", "return " + convert("value", { kind: "struct", name: "State" }, "out", policy));
  expect(toNative({ kind: "idle" })).toEqual({ kind: "idle", value: nullAsUndefined ? undefined : null });
  expect(toJS({ kind: "idle", value: null })).toEqual({ kind: "idle" });
  expect(toJS(toNative({ kind: "ready", value: 42 }))).toEqual({ kind: "ready", value: 42 });
  expect(() => toNative({ kind: "missing" })).toThrow();
  expect(() => toNative({ kind: "ready" })).toThrow();
});
