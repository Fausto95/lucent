import { expect, test } from "vite-plus/test";
import { compile, type LibraryModule } from "@lucent-lang/compiler";
import { classProxies } from "../src/index.ts";
import { classDeclarations } from "../src/objects.ts";

const LIBRARY: LibraryModule = {
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
};

const module = () => {
  const result = compile(
    'import {Box} from "@lucent-lang/sdk/box"; export function f():number{const b = new Box(1); return b.size;}',
    { fileName: "box.lucent.ts", libraries: { "@lucent-lang/sdk/box": LIBRARY } },
  );
  expect(result.diagnostics).toEqual([]);
  return result.module!;
};

test("declares one TypeScript constructor per overload", () => {
  const declaration = classDeclarations(module())[0]!;
  expect(declaration).toContain("constructor(size: number);");
  expect(declaration).toContain("constructor(label: string);");
});

test("the proxy dispatches on arity and runtime kind", () => {
  const proxy = classProxies(module(), false);
  expect(proxy).toContain('if (args.length === 1 && typeof args[0] === "number")');
  expect(proxy).toContain('if (args.length === 1 && typeof args[0] === "string")');
  expect(proxy).toContain("No Box constructor matches these arguments");
});

test("a single constructor keeps its named parameters", () => {
  const result = compile(
    'import {Box} from "@lucent-lang/sdk/box"; export function f():number{const b = new Box(1); return b.size;}',
    {
      fileName: "box.lucent.ts",
      libraries: {
        "@lucent-lang/sdk/box": {
          ...LIBRARY,
          source: `export type Box = {size:number};
export declare function Box__create(size:number):Box;
export declare function Box__get_size(lucentSelf:Box):number;`,
          bindings: {
            Box__create: { swift: ["return NSMutableString()"], kotlin: ["return java.lang.StringBuilder()"] },
            Box__get_size: { swift: ["return 1"], kotlin: ["return 1.0"] },
          },
        },
      },
    },
  );
  expect(result.diagnostics).toEqual([]);
  expect(classProxies(result.module!, false)).toContain("create: (size) =>");
});
