import { expect, test } from "vite-plus/test";
import { compile, type LibraryModule } from "../src/index.ts";
const library: LibraryModule = {
  schemaVersion: 1,
  source:
    "export declare function measureNumber(value:number):number; export declare function measureText(value:string):number;",
  bindings: {
    measureNumber: { overload: "measure", swift: ["return value"], kotlin: ["return value"] },
    measureText: {
      overload: "measure",
      swift: ["return Double(value.count)"],
      kotlin: ["return value.length.toDouble()"],
    },
  },
};
const options = { fileName: "overloads.lucent.ts", libraries: { "@lucent-lang/test": library } };
test("resolves imported overloads to concrete native calls", () => {
  const result = compile(
    'import {measure} from "@lucent-lang/test"; export function f():number{return measure("abc")+measure(4);}',
    options,
  );
  expect(result.diagnostics).toEqual([]);
  const body = JSON.stringify(result.module?.functions.at(-1)?.body);
  expect(body).toContain("measureText");
  expect(body).toContain("measureNumber");
});
test("ambiguous overloads fail independent of declaration order", () => {
  const duplicate = structuredClone(library);
  duplicate.source = duplicate.source.replace("value:string", "value:number");
  const result = compile('import {measure} from "@lucent-lang/test"; export function f():number{return measure(4);}', {
    ...options,
    libraries: { "@lucent-lang/test": duplicate },
  });
  expect(result.module).toBeNull();
  expect(result.diagnostics.some((d) => d.message.includes("Ambiguous"))).toBe(true);
  expect(result.diagnostics[0]?.help).toBe("Candidates:\n  measure(float64)\n  measure(float64)");
});
test("reports no matching overload with the candidates", () => {
  const result = compile(
    'import {measure} from "@lucent-lang/test"; export function f():number{return measure(true);}',
    options,
  );
  expect(result.module).toBeNull();
  expect(result.diagnostics.some((d) => d.message.includes("overload"))).toBe(true);
  expect(result.diagnostics[0]?.help).toBe("Candidates:\n  measure(float64)\n  measure(string)");
});
