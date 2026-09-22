import { expect, test } from "vite-plus/test";
import { compile, type LibraryModule } from "../src/index.ts";
export const textLibrary: LibraryModule = {
  source: `export type MutableText = { length: number };
export declare function MutableText__create(text:string):MutableText;
export declare function MutableText__get_length(lucentSelf:MutableText):number;
export declare function MutableText__method_append(lucentSelf:MutableText,text:string):void;`,
  references: {
    MutableText: { swift: "NSMutableString", swiftImports: ["Foundation"], kotlin: "java.lang.StringBuilder" },
  },
  bindings: {
    MutableText__create: {
      swift: ["return NSMutableString(string: text)"],
      swiftImports: ["Foundation"],
      kotlin: ["return java.lang.StringBuilder(text)"],
    },
    MutableText__get_length: {
      swift: ["return Double(lucentSelf.length)"],
      kotlin: ["return lucentSelf.length.toDouble()"],
    },
    MutableText__method_append: { swift: ["lucentSelf.append(text)"], kotlin: ["lucentSelf.append(text)"] },
  },
};
const options = { fileName: "sdk.lucent.ts", libraries: { "@lucent-lang/sdk/text": textLibrary } };
test("constructs and calls real native SDK references", () => {
  const result = compile(
    'import {MutableText} from "@lucent-lang/sdk/text"; export function size():number {const text=new MutableText("abc");text.append("de");return text.length;}',
    options,
  );
  expect(result.diagnostics).toEqual([]);
  expect(result.module?.structs[0]?.reference?.native?.kotlin).toBe("java.lang.StringBuilder");
  expect(JSON.stringify(result.module?.functions.at(-1)?.body)).toContain("__get_length");
});
test("rejects writes to readonly native properties", () => {
  expect(
    compile(
      'import {MutableText} from "@lucent-lang/sdk/text"; export function f():void{const text=new MutableText("a");text.length=3;}',
      options,
    ).module,
  ).toBeNull();
});
test("rejects native property updates without crashing", () => {
  expect(
    compile(
      'import {MutableText} from "@lucent-lang/sdk/text"; export function f():void{const text=new MutableText("a");text.length++;}',
      options,
    ).module,
  ).toBeNull();
});
test("keeps native listener callbacks out of the JavaScript bridge", () => {
  const library = structuredClone(textLibrary);
  library.source =
    'import type {NativeCallback} from "@lucent-lang/types";' +
    library.source +
    "\nexport declare function MutableText__method_visit(lucentSelf:MutableText,callback:NativeCallback<(value:number)=>number>):number;";
  library.bindings!.MutableText__method_visit = {
    nativeOnly: true,
    swift: ["return try callback(Double(lucentSelf.length))"],
    kotlin: ["return callback(lucentSelf.length.toDouble())"],
  };
  const result = compile(
    'import {MutableText} from "@lucent-lang/sdk/text"; function twice(value:number):number{return value*2;} export function f():number{const text=new MutableText("abc");return text.visit(twice);}',
    { ...options, libraries: { "@lucent-lang/sdk/text": library } },
  );
  expect(result.diagnostics).toEqual([]);
  expect(result.module!.functions.find((f) => f.name.endsWith("__method_visit"))?.exported).toBe(false);
});
test("rejects SDK property bindings with incompatible signatures", () => {
  const library = structuredClone(textLibrary);
  library.source = library.source.replace(
    "__get_length(lucentSelf:MutableText):number",
    "__get_length(lucentSelf:MutableText):string",
  );
  const result = compile(
    'import {MutableText} from "@lucent-lang/sdk/text"; export function f():void {const text=new MutableText("x");}',
    { ...options, libraries: { "@lucent-lang/sdk/text": library } },
  );
  expect(result.module).toBeNull();
  expect(result.diagnostics.some((d) => d.code === "NT1011")).toBe(true);
});
test("rejects asynchronous constructors for native reference handles", () => {
  const library = structuredClone(textLibrary);
  library.source = library.source.replace(
    "__create(text:string):MutableText",
    "__create(text:string):Promise<MutableText>",
  );
  const result = compile('import {MutableText} from "@lucent-lang/sdk/text"; export function f():void {}', {
    ...options,
    libraries: { "@lucent-lang/sdk/text": library },
  });
  expect(result.module).toBeNull();
});
