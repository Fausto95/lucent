import { expect, test } from "vite-plus/test";
import { compile, type LibraryModule } from "../src/index.ts";

const box = (extra: Partial<LibraryModule> = {}): LibraryModule => ({
  schemaVersion: 1,
  source: `export type Box = {size:number};
export declare function Box__create__measured(size:number):Box;
export declare function Box__create__labelled(label:string):Box;
export declare function Box__get_size(lucentSelf:Box):number;`,
  references: { Box: { swift: "NSMutableString", kotlin: "java.lang.StringBuilder" } },
  bindings: {
    Box__create__measured: {
      overload: "Box__create",
      swift: ["return NSMutableString()"],
      kotlin: ["return java.lang.StringBuilder()"],
    },
    Box__create__labelled: {
      overload: "Box__create",
      swift: ["return NSMutableString()"],
      kotlin: ["return java.lang.StringBuilder()"],
    },
    Box__get_size: { swift: ["return 1"], kotlin: ["return 1.0"] },
  },
  ...extra,
});

const compileWith = (source: string, library = box()) =>
  compile(source, { fileName: "box.lucent.ts", libraries: { "@lucent-lang/sdk/box": library } });

test("new selects a constructor overload by argument type", () => {
  const result = compileWith(
    'import {Box} from "@lucent-lang/sdk/box"; export function f():number{const b = new Box("wide"); return b.size;}',
  );
  expect(result.diagnostics).toEqual([]);
  const call = JSON.stringify(result.module?.functions.find((f) => f.name === "f")?.body);
  expect(call).toContain("Box__create__labelled");
});

test("an unmatched constructor lists the candidates", () => {
  const result = compileWith(
    'import {Box} from "@lucent-lang/sdk/box"; export function f():number{const b = new Box(true); return b.size;}',
  );
  expect(result.diagnostics[0]?.code).toBe("LUCENT1012");
  expect(result.diagnostics[0]?.help).toBe("Candidates:\n  Box__create(float64)\n  Box__create(string)");
});

test("constructor overloads JavaScript cannot tell apart are rejected", () => {
  const library = box();
  const result = compileWith('import {Box} from "@lucent-lang/sdk/box"; export function f():number{return 1;}', {
    ...library,
    source: library.source.replace("label:string", "width:number"),
  });
  expect(result.diagnostics.some((d) => d.message.includes("look the same to JavaScript"))).toBe(true);
});

test("instance method overloads select by argument type", () => {
  const library: LibraryModule = {
    schemaVersion: 1,
    source: `export type Box = {size:number};
export declare function Box__create(size:number):Box;
export declare function Box__get_size(lucentSelf:Box):number;
export declare function Box__method_grow__by(lucentSelf:Box,by:number):number;
export declare function Box__method_grow__to(lucentSelf:Box,to:string):number;`,
    references: { Box: { swift: "NSMutableString", kotlin: "java.lang.StringBuilder" } },
    bindings: {
      Box__create: { swift: ["return NSMutableString()"], kotlin: ["return java.lang.StringBuilder()"] },
      Box__get_size: { swift: ["return 1"], kotlin: ["return 1.0"] },
      Box__method_grow__by: { overload: "Box__method_grow", swift: ["return by"], kotlin: ["return by"] },
      Box__method_grow__to: { overload: "Box__method_grow", swift: ["return 1"], kotlin: ["return 1.0"] },
    },
  };
  const result = compileWith(
    'import {Box} from "@lucent-lang/sdk/box"; export function f():number{const b = new Box(1); return b.grow("big");}',
    library,
  );
  expect(result.diagnostics).toEqual([]);
  expect(JSON.stringify(result.module?.functions.find((f) => f.name === "f")?.body)).toContain("Box__method_grow__to");
});
