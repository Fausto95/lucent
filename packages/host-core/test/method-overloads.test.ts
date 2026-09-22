import { expect, test } from "vite-plus/test";
import { compile, type LibraryModule } from "../../compiler/src/index.ts";
import { classProxies } from "../src/objects.ts";
import { expoHost } from "../../host-expo/src/index.ts";
import { nitroHost } from "../../host-nitro/src/index.ts";
import { defineNativeClass, lucentCall, nativeObjectHandle } from "../../runtime/src/index.ts";

function library(async: boolean): LibraryModule {
  const result = async ? "Promise<number>" : "number";
  return {
    source: `export type Box={};
export declare function Box__create():Box;
export declare function Box__method_measure__number(lucentSelf:Box,value:number):${result};
export declare function Box__method_measure__text(lucentSelf:Box,value:string):${result};
export declare function Box__method_measure__empty(lucentSelf:Box):${result};`,
    references: {
      Box: {
        swift: "NSString",
        kotlin: "java.lang.String",
        contract: { ownership: "owned", executor: "caller", transferable: true },
      },
    },
    bindings: {
      Box__create: { swift: ['return NSString(string: "")'], kotlin: ['return java.lang.String("")'] },
      Box__method_measure__number: {
        overload: "Box__method_measure",
        swift: ["return value"],
        kotlin: ["return value"],
      },
      Box__method_measure__text: { overload: "Box__method_measure", swift: ["return 1"], kotlin: ["return 1.0"] },
      Box__method_measure__empty: { overload: "Box__method_measure", swift: ["return 0"], kotlin: ["return 0.0"] },
    },
  };
}
for (const [index, host] of [expoHost, nitroHost].entries())
  for (const async of [false, true]) {
    test(`${host.name} executes every ${async ? "async" : "sync"} method overload without replacement`, async () => {
      const specifier = `@sdk/${host.name}-${async}`;
      const result = compile(`import {Box} from '${specifier}'; export function make():Box{return new Box();}`, {
        fileName: "methods.lucent.ts",
        libraries: { [specifier]: library(async) },
      });
      expect(result.diagnostics).toEqual([]);
      const module = result.module!;
      const type = module.structs.find((s) => s.reference)!.name;
      const ctor = module.functions.find((f) => f.classOp?.kind === "constructor")!;
      const methods = module.functions.filter((f) => f.classOp?.kind === "method");
      const calls: unknown[][] = [];
      const released: number[] = [];
      const handle = 8000 + index * 10 + Number(async);
      const native: Record<string, unknown> = {
        [ctor.name]: () => handle,
        lucentRelease: (id: number) => released.push(id),
      };
      for (const fn of methods)
        native[fn.name] = (...args: unknown[]) => {
          calls.push(args);
          const value =
            fn.params.length === 1
              ? 0
              : fn.params[1]!.type.kind === "string"
                ? (args[1] as string).length
                : Number(args[1]) + 100;
          return async ? Promise.resolve(value) : value;
        };
      const Class = new Function(
        "native",
        "defineNativeClass",
        "lucentCall",
        "nativeObjectHandle",
        classProxies(module, host.name === "expo") + `\nreturn ${type};`,
      )(native, defineNativeClass, lucentCall, nativeObjectHandle) as new () => {
        measure(...args: unknown[]): number | Promise<number>;
        dispose(): void;
      };
      const box = new Class();
      expect(host.emitProxy(module).dts.match(/measure\(/g)).toHaveLength(3);
      if (async) await expect(box.measure(true)).rejects.toThrow("No Box.measure overload");
      const number = box.measure(7),
        text = box.measure("hello"),
        empty = box.measure();
      if (async) {
        expect(number).toBeInstanceOf(Promise);
        box.dispose();
        expect(released).toEqual([]);
      } else {
        expect(number).toBe(107);
        expect(() => box.measure(true)).toThrow("No Box.measure overload");
      }
      expect(await number).toBe(107);
      expect(await text).toBe(5);
      expect(await empty).toBe(0);
      expect(calls).toEqual([[handle, 7], [handle, "hello"], [handle]]);
      box.dispose();
      expect(released).toEqual([handle]);
    });
  }

test("rejects indistinguishable JavaScript method overloads", () => {
  const lib = library(false);
  lib.source = lib.source.replace("value:string", "value:number");
  const result = compile("import {Box} from '@sdk/ambiguous'; export function make():Box{return new Box();}", {
    fileName: "ambiguous.lucent.ts",
    libraries: { "@sdk/ambiguous": lib },
  });
  expect(result.module).toBeNull();
  expect(result.diagnostics.some((d) => d.message.includes("look the same to JavaScript"))).toBe(true);
});
test("rejects mixed completion contracts on one JavaScript method", () => {
  const lib = library(false);
  lib.source = lib.source.replace("value:string):number", "value:string):Promise<number>");
  const result = compile("import {Box} from '@sdk/mixed'; export function make():Box{return new Box();}", {
    fileName: "mixed.lucent.ts",
    libraries: { "@sdk/mixed": lib },
  });
  expect(result.module).toBeNull();
  expect(result.diagnostics.some((d) => d.message.includes("synchronous or all asynchronous"))).toBe(true);
});

test("nullable overloads dispatch null, undefined and present values", () => {
  const lib = library(false);
  lib.source = lib.source.replace("value:number", "value:boolean").replace("value:string", "value:string | null");
  const result = compile("import {Box} from '@sdk/nullable'; export function make():Box{return new Box();}", {
    fileName: "nullable.lucent.ts",
    libraries: { "@sdk/nullable": lib },
  });
  expect(result.diagnostics).toEqual([]);
  const module = result.module!,
    type = module.structs.find((s) => s.reference)!.name;
  const native: Record<string, unknown> = { lucentRelease: () => {} };
  for (const fn of module.functions) {
    if (fn.classOp?.kind === "constructor") native[fn.name] = () => 8100;
    if (fn.classOp?.kind === "method")
      native[fn.name] = () => (fn.params.length === 1 ? 0 : fn.params[1]!.type.kind === "bool" ? 1 : 2);
  }
  const Class = new Function(
    "native",
    "defineNativeClass",
    "lucentCall",
    "nativeObjectHandle",
    classProxies(module, false) + `\nreturn ${type};`,
  )(native, defineNativeClass, lucentCall, nativeObjectHandle) as new () => {
    measure(...args: unknown[]): number;
    dispose(): void;
  };
  const box = new Class();
  expect(box.measure(null)).toBe(2);
  expect(box.measure(undefined)).toBe(2);
  expect(box.measure("text")).toBe(2);
  expect(box.measure(true)).toBe(1);
  expect(box.measure()).toBe(0);
  box.dispose();
});
test("nullable overloads cannot overlap a present-value signature", () => {
  const lib = library(false);
  lib.source = lib.source.replace("value:string", "value:number | null");
  const result = compile("import {Box} from '@sdk/overlap'; export function make():Box{return new Box();}", {
    fileName: "overlap.lucent.ts",
    libraries: { "@sdk/overlap": lib },
  });
  expect(result.module).toBeNull();
  expect(result.diagnostics.some((d) => d.message.includes("look the same to JavaScript"))).toBe(true);
});
