import { expect, test } from "vite-plus/test";
import { compile, validateLibrary, type LibraryModule } from "../src/index.ts";
import { expoHost } from "../../host-expo/src/index.ts";
import { nitroHost } from "../../host-nitro/src/index.ts";
const library: LibraryModule = {
  source: `import type {NativeCallback} from '@lucent-lang/core/types';
export type Frame={width:number};
export type Listener={};
export declare function borrowFrame():Frame;
export declare function Frame__get_width(lucentSelf:Frame):number;
export declare function Listener__create(callback:NativeCallback<(value:number)=>boolean>):Listener;
export declare function deliver(listener:Listener,value:number):boolean;`,
  references: {
    Frame: {
      nativeOnly: true,
      swift: "SDKFrame",
      kotlin: "SDKFrame",
      contract: { ownership: "external", executor: "caller" },
    },
    Listener: {
      nativeOnly: true,
      swift: "SDKListener",
      kotlin: "SDKListener",
      contract: { ownership: "owned", executor: "caller" },
    },
  },
  bindings: {
    borrowFrame: {
      nativeOnly: true,
      contract: { symbolId: "frame.borrow", result: "borrowed" },
      swift: ["return SDKFrame()"],
      kotlin: ["return SDKFrame()"],
    },
    Frame__get_width: { swift: ["return lucentSelf.width"], kotlin: ["return lucentSelf.width"] },
    Listener__create: {
      nativeOnly: true,
      contract: {
        symbolId: "listener.create",
        result: "owned",
        parameters: {
          callback: {
            ownership: "retained",
            callback: { retention: "subscription", executor: "caller", errors: "propagate" },
          },
        },
      },
      swift: ["return SDKListener(callback)"],
      kotlin: ["return SDKListener(callback)"],
    },
    deliver: {
      nativeOnly: true,
      swift: ["return try listener.callback(value)"],
      kotlin: ["return listener.callback(value)"],
    },
  },
};
const options = { fileName: "native-only.lucent.ts", libraries: { "@sdk/native-only": library } };
test("SDK-owned native-only references do not need fictitious constructors", () => {
  const result = compile(
    `import {borrowFrame} from '@sdk/native-only'; export function width():number{const frame=borrowFrame();return frame.width;}`,
    options,
  );
  expect(result.diagnostics).toEqual([]);
  for (const host of [expoHost, nitroHost]) {
    const proxy = host.emitProxy(result.module!);
    expect(proxy.js).not.toContain("defineNativeClass");
    expect(proxy.dts).not.toContain("declare class");
    expect(proxy.dts).toContain("width()");
  }
  expect(result.module!.functions.filter((fn) => fn.classOp).every((fn) => !fn.exported)).toBe(true);
});
test("owned native-only delegates accept retained compiled callbacks", () => {
  const result = compile(
    `import {Listener,deliver} from '@sdk/native-only'; export function decision():boolean{const threshold=3;const listener=new Listener((value:number):boolean=>value>threshold);return deliver(listener,4);}`,
    options,
  );
  expect(result.diagnostics).toEqual([]);
});
test.each([
  "export function leak(listener:Listener):Listener{return listener;}",
  "export function leak():Listener{return new Listener((value:number):boolean=>value>0);}",
  "export async function leak(listener:Listener):Promise<number>{return 1;}",
])("native-only resources cannot be exposed through bridge signatures: %s", (source) => {
  const result = compile(`import {Listener} from '@sdk/native-only'; ${source}`, options);
  expect(result.module).toBeNull();
  expect(result.diagnostics.some((d) => d.message.includes("Native-only SDK resources"))).toBe(true);
});
test("the nativeOnly reference flag is validated", () => {
  expect(
    validateLibrary({ ...library, references: { Frame: { swift: "Frame", nativeOnly: "yes" as unknown as boolean } } }),
  ).toContain("Invalid nativeOnly flag for Frame.");
});
