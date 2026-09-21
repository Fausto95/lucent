import { expect, test } from "vite-plus/test";
import { compile, type LibraryModule } from "../src/index.ts";
export const textLibrary: LibraryModule = {
  source: `export type MutableText = { length: number };
export declare function MutableText__create(text:string):MutableText;
export declare function MutableText__get_length(lucentSelf:MutableText):number;
export declare function MutableText__method_append(lucentSelf:MutableText,text:string):void;`,
  references: { MutableText: { swift: "NSMutableString", swiftImports: ["Foundation"], kotlin: "java.lang.StringBuilder" } },
  bindings: {
    MutableText__create: { swift: ["return NSMutableString(string: text)"], swiftImports: ["Foundation"], kotlin: ["return java.lang.StringBuilder(text)"] },
    MutableText__get_length: { swift: ["return Double(lucentSelf.length)"], kotlin: ["return lucentSelf.length.toDouble()"] },
    MutableText__method_append: { swift: ["lucentSelf.append(text)"], kotlin: ["lucentSelf.append(text)"] },
  },
};
const options = { fileName: "sdk.lucent.ts", libraries: { "@lucent-lang/sdk/text": textLibrary } };
test("constructs and calls real native SDK references", () => {
 const result = compile('import {MutableText} from "@lucent-lang/sdk/text"; export function size():number {const text=new MutableText("abc");text.append("de");return text.length;}',options);
 expect(result.diagnostics).toEqual([]);
 expect(result.module?.structs[0]?.reference?.native?.kotlin).toBe("java.lang.StringBuilder");
 expect(JSON.stringify(result.module?.functions.at(-1)?.body)).toContain("__get_length");
});
test("rejects writes to readonly native properties",()=>{
 expect(compile('import {MutableText} from "@lucent-lang/sdk/text"; export function f():void{const text=new MutableText("a");text.length=3;}',options).module).toBeNull();
});
test('rejects native property updates without crashing',()=>{
 expect(compile('import {MutableText} from "@lucent-lang/sdk/text"; export function f():void{const text=new MutableText("a");text.length++;}',options).module).toBeNull();
});
