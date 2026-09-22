import { expect, test } from "vite-plus/test";
import { compile, renderDiagnostic } from "../src/index.ts";
test.each([
  ["MainThread", "main"],
  ["Background", "worker"],
  ["Inherited", "caller"],
])("lowers @%s to %s", (decorator, thread) => {
  const r = compile(`@${decorator}\nexport async function f():Promise<number>{return 1;}`, {
    fileName: "work.lucent.ts",
  });
  expect(r.diagnostics).toEqual([]);
  expect(r.module?.functions[0]?.thread).toBe(thread);
});
test.each(["@Unknown", "@Background()", "@MainThread\n@Background", "/** @thread worker */"])(
  "rejects obsolete or invalid thread annotations: %s",
  (annotation) => {
    expect(
      compile(`${annotation}\nexport async function f():Promise<number>{return 1;}`, { fileName: "work.lucent.ts" })
        .module,
    ).toBeNull();
  },
);
test("keeps decorator-like text inside strings and comments untouched", () => {
  const r = compile("export function text():string{return `@Background\\n`;}", { fileName: "work.lucent.ts" });
  expect(r.diagnostics).toEqual([]);
});
test("warns for expensive transitive main-thread work without rejecting the module", () => {
  const r = compile(
    "@MainThread\nexport async function f(values:number[]):Promise<number>{return total(values);}\nfunction total(values:number[]):number{let n=0;for(const v of values){n+=v;}return n;}",
    { fileName: "work.lucent.ts" },
  );
  expect(r.module).not.toBeNull();
  expect(r.diagnostics).toEqual(
    expect.arrayContaining([expect.objectContaining({ code: "LUCENT3002", severity: "warning" })]),
  );
  expect(renderDiagnostic(r.diagnostics[0]!, "", "work.lucent.ts")).toContain("warning LUCENT3002");
});
test("does not warn when a main-thread function awaits explicitly background work", () => {
  const r = compile(
    "@MainThread\nexport async function f():Promise<number>{return await work();}\n@Background\nasync function work():Promise<number>{let n=0;while(n<10){n+=1;}return n;}",
    { fileName: "work.lucent.ts" },
  );
  expect(r.diagnostics).toEqual([]);
});

test("NativeOnly composes with one executor annotation", () => {
  const result = compile("@NativeOnly @Background export async function work():Promise<number>{return 1;}", {
    fileName: "native-only.lucent.ts",
  });
  expect(result.diagnostics).toEqual([]);
  expect(result.module!.functions[0]!.exported).toBe(false);
  expect(result.module!.functions[0]!.thread).toBe("worker");
});
test.each(["@NativeOnly @NativeOnly", "@NativeOnly()"])("rejects invalid native-only decorators: %s", (decorator) => {
  expect(
    compile(`${decorator} export function work():number{return 1;}`, { fileName: "native-only.lucent.ts" }).module,
  ).toBeNull();
});
