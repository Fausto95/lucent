import { expect, test } from "vite-plus/test";
import { compile, type LibraryModule } from "../src/index.ts";
const library: LibraryModule = {
  source: `import type {NativeCallback} from '@lucent-lang/core/types';
export type Frame={width:number};
export declare function Frame__get_width(lucentSelf:Frame):number;
export declare function frames(callback:NativeCallback<(frame:Frame)=>number>):number;
export declare function leak(callback:NativeCallback<(frame:Frame)=>Frame>):void;
export declare function later(callback:NativeCallback<()=>number>):void;
export declare function now(callback:NativeCallback<()=>number>):number;
export declare function retain(frame:Frame):void;`,
  references: {
    Frame: {
      nativeOnly: true,
      swift: "Frame",
      kotlin: "Frame",
      contract: { ownership: "external", executor: "caller" },
    },
  },
  bindings: {
    Frame__get_width: { swift: ["return lucentSelf.width"], kotlin: ["return lucentSelf.width"] },
    frames: { nativeOnly: true, swift: ["return try callback(Frame())"], kotlin: ["return callback(Frame())"] },
    leak: { nativeOnly: true, swift: [], kotlin: [] },
    later: { nativeOnly: true, swift: [], kotlin: [] },
    now: {
      nativeOnly: true,
      contract: {
        symbolId: "now",
        parameters: {
          callback: { ownership: "value", callback: { retention: "call", executor: "caller", errors: "propagate" } },
        },
      },
      swift: ["return try callback()"],
      kotlin: ["return callback()"],
    },
    retain: {
      nativeOnly: true,
      contract: { symbolId: "retain", parameters: { frame: { ownership: "retained" } } },
      swift: [],
      kotlin: [],
    },
  },
};
const options = { fileName: "borrowed-callback.lucent.ts", libraries: { "@sdk/frames": library } };
const run = (body: string) =>
  compile(`import {Frame,frames,leak,later,now,retain} from '@sdk/frames'; ${body}`, options);
test("borrowed SDK callback parameters may be read and passed to scoped helpers", () => {
  const result = run(
    "function read(frame:Frame):number{return frame.width;} export function run():number{return frames((frame:Frame):number=>read(frame));}",
  );
  expect(result.diagnostics).toEqual([]);
});
test("borrowed SDK callback parameters may enter explicitly nonescaping closures", () => {
  expect(
    run("export function run():number{return frames((frame:Frame):number=>now(():number=>frame.width));}").diagnostics,
  ).toEqual([]);
});
test.each([
  "export function run():void{leak((frame:Frame):Frame=>frame);}",
  "export function run():void{leak((frame:Frame):Frame=>{return frame;});}",
  "export function run():number{return frames((frame:Frame):number=>{retain(frame);return 0;});}",
  "function escape(frame:Frame):Frame{return frame;} export function run():number{return 0;}",
])("rejects borrowed callback escape: %s", (source) => {
  const result = run(source);
  expect(result.module).toBeNull();
  expect(result.diagnostics.some((d) => d.code === "LUCENT1018")).toBe(true);
});
test("borrowed SDK callback parameters cannot be retained by another callback", () => {
  const result = run(
    "export function run():number{return frames((frame:Frame):number=>{later(():number=>frame.width);return 0;});}",
  );
  expect(result.module).toBeNull();
  expect(result.diagnostics.some((d) => d.code === "LUCENT1005")).toBe(true);
});

test("native-only processor exports can be shared across Lucent source files", () => {
  const source =
    "import {Frame,frames} from '@sdk/frames'; import {read} from './processor.lucent'; export function run():number{return frames((frame:Frame):number=>read(frame));}";
  const processor =
    "import {Frame} from '@sdk/frames'; @NativeOnly export function read(frame:Frame):number{return frame.width;}";
  const standalone = compile(processor, { ...options, fileName: "processor.lucent.ts" });
  expect(standalone.diagnostics).toEqual([]);
  expect(standalone.module!.functions.find((fn) => fn.name === "read")!.exported).toBe(false);
  const result = compile(source, { ...options, sources: { "processor.lucent.ts": processor } });
  expect(result.diagnostics).toEqual([]);
  expect(result.module!.functions.filter((fn) => fn.exported).map((fn) => fn.name)).toEqual(["run"]);
});
