import { expect, test } from "vite-plus/test";
import { compile } from "../src/index.ts";
const source =
  'import type {NativeCallback} from "@lucent-lang/types"; function apply(value:number,callback:NativeCallback<(value:number)=>number>):number{return callback(value);} function double(value:number):number{return value*2;} export function result():number{return apply(4,double);}';
test("passes and invokes a typed compiled native function", () => {
  const result = compile(source, { fileName: "callbacks.lucent.ts" });
  expect(result.diagnostics).toEqual([]);
  expect(JSON.stringify(result.module)).toContain("functionRef");
  expect(JSON.stringify(result.module)).toContain("invoke");
});
test("rejects mismatched native callback signatures", () => {
  expect(
    compile(
      source.replace("return apply(4,double)", "return apply(4,wrong)") +
        " function wrong(value:string):string{return value;}",
      { fileName: "callbacks.lucent.ts" },
    ).module,
  ).toBeNull();
});
test("rejects native callbacks at the JavaScript boundary", () => {
  const result = compile(source.replace("function apply", "export function apply"), {
    fileName: "callbacks.lucent.ts",
  });
  expect(result.module).toBeNull();
  expect(result.diagnostics.some((d) => d.code === "NT1005")).toBe(true);
});
test("checks platform requirements inside referenced callbacks", () => {
  const input =
    'import type {NativeCallback} from "@lucent-lang/types"; import {onlyIOS} from "@lucent-lang/sdk/ios"; function run(callback:NativeCallback<()=>number>):number{return callback();} function ios():number{return onlyIOS();} export function result():number{return run(ios);}';
  const result = compile(input, {
    fileName: "callbacks.lucent.ts",
    libraries: {
      "@lucent-lang/sdk/ios": {
        source: "export declare function onlyIOS():number;",
        bindings: { onlyIOS: { platforms: ["ios"], swift: ["return 1"], kotlin: [] } },
      },
    },
  });
  expect(result.module).toBeNull();
  expect(result.diagnostics.some((d) => d.code === "NT2004")).toBe(true);
});
test('retains capabilities reached through compiled callbacks',()=>{
 const input='import type {NativeCallback} from "@lucent-lang/types"; import {now} from "@lucent-lang/platform/clock"; function run(callback:NativeCallback<()=>number>):number{return callback();} function read():number{return now();} export function result():number{return run(read);}';
 expect(compile(input,{fileName:'callbacks.lucent.ts'}).module?.capabilities).toContain('clock');
});
