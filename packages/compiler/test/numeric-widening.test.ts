import { expect, test } from "vite-plus/test";
import { compile, type LibraryModule } from "../src/index.ts";
import { generateSwift } from "../../backend-swift/src/index.ts";
import { generateKotlin } from "../../backend-kotlin/src/index.ts";

const library: LibraryModule = {
  source:
    'import type {int16} from "@lucent-lang/core/types"; export declare function small(value:int16):int16; export declare function text(value:string):int16;',
  bindings: {
    small: { overload: "read", swift: ["return value"], kotlin: ["return value"] },
    text: { overload: "read", swift: ["return 0"], kotlin: ["return 0"] },
  },
};
const options = { fileName: "widen.lucent.ts", libraries: { "@sdk/numbers": library } };
test("native overload arguments carry an explicit lossless widening in IR", () => {
  const result = compile(
    'import {read} from "@sdk/numbers"; import type {int8,int16} from "@lucent-lang/core/types"; export function f(value:int8):int16{return read(value);}',
    options,
  );
  expect(result.diagnostics).toEqual([]);
  expect(JSON.stringify(result.module)).toContain('"op":"widen"');
  expect(generateSwift(result.module!).code).toContain("Int16(value)");
  expect(generateKotlin(result.module!).code).toContain("(value).toShort()");
});
test("native overloads reject narrowing numeric variables", () => {
  const result = compile(
    'import {read} from "@sdk/numbers"; import type {int16,int32} from "@lucent-lang/core/types"; export function f(value:int32):int16{return read(value);}',
    options,
  );
  expect(result.module).toBeNull();
  expect(result.diagnostics.some((d) => d.message.includes("No matching"))).toBe(true);
});
test("ordinary Lucent calls retain strict numeric types", () => {
  const result = compile(
    'import type {int8,int16} from "@lucent-lang/core/types"; function same(value:int16):int16{return value;} export function f(value:int8):int16{return same(value);}',
    { fileName: "strict.lucent.ts" },
  );
  expect(result.module).toBeNull();
  expect(result.diagnostics.some((d) => d.code === "LUCENT1011")).toBe(true);
});

test.each([
  ["int32", "float32"],
  ["int64", "float64"],
  ["uint64", "float64"],
  ["int8", "uint16"],
  ["uint16", "int16"],
  ["float64", "float32"],
])("rejects potentially lossy SDK conversion %s to %s", (source, target) => {
  const result = compile(
    `import type {${source},${target}} from "@lucent-lang/core/types"; import {accept} from "@sdk/numbers"; export function f(value:${source}):${target}{return accept(value);}`,
    {
      fileName: "lossy.lucent.ts",
      libraries: {
        "@sdk/numbers": {
          source: `import type {${target}} from "@lucent-lang/core/types"; export declare function accept(value:${target}):${target};`,
          bindings: { accept: { swift: ["return value"], kotlin: ["return value"] } },
        },
      },
    },
  );
  expect(result.module).toBeNull();
  expect(result.diagnostics.some((d) => d.code === "LUCENT1011")).toBe(true);
});

test("an exact native overload wins over widening", () => {
  const extended = structuredClone(library);
  extended.source +=
    ' import type {int8} from "@lucent-lang/core/types"; export declare function exact(value:int8):int16;';
  extended.bindings!.exact = { overload: "read", swift: ["return Int16(value)"], kotlin: ["return value.toShort()"] };
  const result = compile(
    'import {read} from "@sdk/numbers"; import type {int8,int16} from "@lucent-lang/core/types"; export function f(value:int8):int16{return read(value);}',
    { ...options, libraries: { "@sdk/numbers": extended } },
  );
  expect(result.diagnostics).toEqual([]);
  expect(JSON.stringify(result.module!.functions.at(-1)!.body)).toContain("exact");
  expect(JSON.stringify(result.module!.functions.at(-1)!.body)).not.toContain('"op":"widen"');
});
