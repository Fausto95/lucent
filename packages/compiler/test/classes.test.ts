import { expect, test } from "vite-plus/test";
import { compile } from "../src/index.ts";
export const counter = `export class Counter {
  value: number = 0;
  constructor(initial: number) { this.value = initial; }
  increment(delta: number): number { this.value += delta; return this.value; }
}
export function make(): Counter { return new Counter(2); }
export function increment(counter: Counter): number { return counter.increment(1); }`;
test("compiles native reference classes, constructors, and methods", () => {
  const result = compile(counter, { fileName: "counter.lucent.ts" });
  expect(result.diagnostics).toEqual([]);
  expect(result.module?.structs.find((s) => s.reference)?.reference?.publicName).toBe("Counter");
});
test("shares a class identity across imported modules", () => {
  const a = compile(counter, { fileName: "counter.lucent.ts" }).module;
  const b = compile(
    'import {Counter} from "./counter.lucent"; export function f():number { const c = new Counter(1); return c.increment(2); }',
    { fileName: "use.lucent.ts", sources: { "counter.lucent.ts": counter } },
  );
  expect(b.diagnostics).toEqual([]);
  expect(b.module?.structs.find((s) => s.reference)?.name).toBe(a?.structs.find((s) => s.reference)?.name);
});
test("requires initialized fields and rejects async shared methods", () => {
  expect(
    compile(counter.replace("value: number = 0", "value: number"), { fileName: "counter.lucent.ts" }).diagnostics
      .length,
  ).toBeGreaterThan(0);
  expect(
    compile(counter.replace("increment(delta: number): number", "async increment(delta: number): Promise<number>"), {
      fileName: "counter.lucent.ts",
    }).diagnostics.length,
  ).toBeGreaterThan(0);
});

test("supports the typed SharedObject base without JS inheritance", () => {
  const source='import {SharedObject} from "@lucent-lang/objects"; '+counter.replace('class Counter {','class Counter extends SharedObject {').replace('constructor(initial: number) {','constructor(initial: number) { super();');
  expect(compile(source,{fileName:"counter.lucent.ts"}).diagnostics).toEqual([]);
});
