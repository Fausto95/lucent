import { expect, test } from "vite-plus/test";
import { compile, type LibraryModule } from "../src/index.ts";

const library: LibraryModule = {
  schemaVersion: 1,
  source: `import type {NativeCallback} from "@lucent-lang/core/types";
export type Buffer = { length: number };
export type Owned = { length: number };
export declare function Buffer__create():Buffer;
export declare function Buffer__get_length(lucentSelf:Buffer):number;
export declare function borrow():Buffer;
export declare function Owned__create():Owned;
export declare function Owned__get_length(lucentSelf:Owned):number;
export declare function withBorrow(buffer:Buffer,callback:NativeCallback<(value:number)=>number>):number;
export declare function subscribe(buffer:Buffer,callback:NativeCallback<(value:number)=>number>):void;`,
  references: {
    Buffer: { swift: "Buf", kotlin: "Buf", contract: { ownership: "owned", executor: "caller" } },
    Owned: { swift: "OwnedBox", kotlin: "OwnedBox", contract: { ownership: "owned", executor: "caller" } },
  },
  bindings: {
    Buffer__create: {
      contract: { symbolId: "buf.init", result: "owned" },
      swift: ["return Buf()"],
      kotlin: ["return Buf()"],
    },
    Buffer__get_length: {
      contract: { symbolId: "buf.length" },
      swift: ["return 1"],
      kotlin: ["return 1.0"],
    },
    borrow: {
      contract: { symbolId: "buf.borrow", result: "borrowed" },
      swift: ["return Buf()"],
      kotlin: ["return Buf()"],
    },
    Owned__create: {
      contract: { symbolId: "owned.init", result: "owned" },
      swift: ["return OwnedBox()"],
      kotlin: ["return OwnedBox()"],
    },
    Owned__get_length: {
      contract: { symbolId: "owned.length" },
      swift: ["return 1"],
      kotlin: ["return 1.0"],
    },
    withBorrow: {
      contract: {
        symbolId: "buf.with",
        parameters: {
          buffer: { ownership: "borrowed" },
          callback: { ownership: "value", callback: { retention: "call", executor: "caller", errors: "propagate" } },
        },
      },
      swift: ["return callback(1)"],
      kotlin: ["return callback(1.0)"],
    },
    subscribe: {
      contract: {
        symbolId: "buf.sub",
        parameters: {
          buffer: { ownership: "borrowed" },
          callback: {
            ownership: "value",
            callback: { retention: "subscription", executor: "caller", errors: "propagate" },
          },
        },
      },
      swift: ["_ = callback(1)"],
      kotlin: ["callback(1.0)"],
    },
  },
};
const options = { fileName: "captures.lucent.ts", libraries: { "@lucent-lang/sdk/buf": library } };
const apply =
  'import type {NativeCallback} from "@lucent-lang/core/types"; function apply(value:number,callback:NativeCallback<(value:number)=>number>):number{return callback(value);}';

test("records an immutable value record as a value capture", () => {
  const result = compile(
    `${apply} type Point={x:number;y:number}; export function captured():number{ const point:Point={x:1,y:2}; return apply(1,(value:number):number=>value+point.x); }`,
    { fileName: "captures.lucent.ts" },
  );
  expect(result.diagnostics).toEqual([]);
  expect(JSON.stringify(result.module)).toContain('"kind":"value"');
});

test("weak capture of an owned reference is optional and explicit", () => {
  const result = compile(
    `${apply} import {Owned} from "@lucent-lang/sdk/buf"; export function captured():number{ const box=new Owned(); return apply(1,(value:number):number=>{ const current=weak(box); if (current===null) return 0; return value+current.length; }); }`,
    options,
  );
  expect(result.diagnostics).toEqual([]);
  expect(JSON.stringify(result.module)).toContain('"kind":"weak"');
});

test("rejects a weak capture that is not an immutable owned reference", () => {
  const result = compile(
    `${apply} import {borrow} from "@lucent-lang/sdk/buf"; export function captured():number{ const buffer=borrow(); return apply(1,(value:number):number=>{ const current=weak(buffer); if (current===null) return 0; return value+current.length; }); }`,
    options,
  );
  expect(result.module).toBeNull();
  expect(result.diagnostics.some((d) => d.code === "LUCENT1005")).toBe(true);
});

test("a nonescaping callback may capture a borrow", () => {
  const result = compile(
    'import {borrow,withBorrow} from "@lucent-lang/sdk/buf"; export function run():number{ const buffer=borrow(); return withBorrow(buffer,(value:number):number=>value+buffer.length); }',
    options,
  );
  expect(result.diagnostics).toEqual([]);
  expect(JSON.stringify(result.module)).toContain('"kind":"borrowed"');
});

test("an escaping callback rejects a borrowed capture", () => {
  const result = compile(
    'import {borrow,subscribe} from "@lucent-lang/sdk/buf"; export function run():void{ const buffer=borrow(); subscribe(buffer,(value:number):number=>value+buffer.length); }',
    options,
  );
  expect(result.module).toBeNull();
  expect(result.diagnostics.some((d) => d.message.includes("capture"))).toBe(true);
});
