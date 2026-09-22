/**
 * Execute real SDK instances and compiled callbacks on both native toolchains.
 * Harness runners live under scripts/native/verify-interop/; the object registry
 * runtime is passed through the packages fill.
 */
import { compile, type LibraryModule } from "../packages/compiler/src/index.ts";
import { generateSwift, swiftRuntime, swiftObjectRuntime } from "../packages/backend-swift/src/index.ts";
import { generateKotlin, kotlinRuntime, kotlinObjectRuntime } from "../packages/backend-kotlin/src/index.ts";
import {
  compileAndRunKotlin,
  compileAndRunSwift,
  fillVerifyHarness,
  readNativeTemplate,
} from "./lib/verify-harness.ts";

const library: LibraryModule = {
  source: `export type MutableText={length:number};
export declare function MutableText__create(text:string):MutableText;
export declare function MutableText__get_length(lucentSelf:MutableText):number;
export declare function MutableText__method_append(lucentSelf:MutableText,text:string):void;`,
  references: {
    MutableText: { swift: "NSMutableString", swiftImports: ["Foundation"], kotlin: "java.lang.StringBuilder" },
  },
  bindings: {
    MutableText__create: {
      swift: ["return NSMutableString(string: text)"],
      kotlin: ["return java.lang.StringBuilder(text)"],
    },
    MutableText__get_length: {
      swift: ["return Double(lucentSelf.length)"],
      kotlin: ["return lucentSelf.length.toDouble()"],
    },
    MutableText__method_append: { swift: ["lucentSelf.append(text)"], kotlin: ["lucentSelf.append(text)"] },
  },
};
const source = `import {MutableText} from '@lucent-lang/sdk/text';
import type {NativeCallback} from '@lucent-lang/core/types';
function twice(value:number):number{return value*2;}
function apply(value:number,callback:NativeCallback<(value:number)=>number>):number{return callback(value);}
export function compute():number{const text=new MutableText('abc');text.append('de');const factor=2;return apply(text.length,(value:number):number=>value*factor);}`;
const result = compile(source, { fileName: "interop.lucent.ts", libraries: { "@lucent-lang/sdk/text": library } });
if (!result.module) throw new Error(JSON.stringify(result.diagnostics));
const ir = result.module;

const runtimeSwift = swiftRuntime({
  length: "return Double(buffer.count)",
  get: "return Double(buffer[Int(index)])",
});
const runtimeKotlin = kotlinRuntime({
  imports: [],
  length: "return buffer.size.toDouble()",
  get: "return buffer[index.toInt()].toDouble()",
});

compileAndRunSwift(
  fillVerifyHarness(readNativeTemplate("verify-interop", "Runner.swift"), {
    runtime: runtimeSwift,
    packages: [swiftObjectRuntime],
    generated: generateSwift(ir).code,
  }),
  "lucent-interop-",
);

compileAndRunKotlin(
  fillVerifyHarness(readNativeTemplate("verify-interop", "Main.kt"), {
    runtime: runtimeKotlin,
    packages: [kotlinObjectRuntime],
    generated: generateKotlin(ir).code,
  }),
  "lucent-interop-",
);
