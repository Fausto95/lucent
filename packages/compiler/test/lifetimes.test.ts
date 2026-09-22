import { expect, test } from "vite-plus/test";
import { compile, type LibraryModule } from "../src/index.ts";

const library: LibraryModule = {
  schemaVersion: 1,
  source: `export type Buffer = { length: number };
export type SerialBox = { length: number };
export declare function Buffer__create():Buffer;
export declare function Buffer__get_length(lucentSelf:Buffer):number;
export declare function Buffer__method_close(lucentSelf:Buffer):void;
export declare function borrow():Buffer;
export declare function SerialBox__create():SerialBox;
export declare function SerialBox__get_length(lucentSelf:SerialBox):number;`,
  references: {
    Buffer: { swift: "Buf", kotlin: "Buf", contract: { ownership: "owned", executor: "main", close: "close" } },
    SerialBox: { swift: "Box", kotlin: "Box", contract: { ownership: "owned", executor: "serial" } },
  },
  bindings: {
    Buffer__create: {
      contract: { symbolId: "buf.init", result: "owned", executor: "main" },
      swift: ["return Buf()"],
      kotlin: ["return Buf()"],
    },
    Buffer__get_length: {
      contract: { symbolId: "buf.length", executor: "main" },
      swift: ["return 1"],
      kotlin: ["return 1.0"],
    },
    Buffer__method_close: {
      contract: { symbolId: "buf.close", executor: "main" },
      swift: ["lucentSelf.close()"],
      kotlin: ["lucentSelf.close()"],
    },
    borrow: {
      contract: { symbolId: "buf.borrow", result: "borrowed", executor: "main" },
      swift: ["return Buf()"],
      kotlin: ["return Buf()"],
    },
    SerialBox__create: { swift: ["return Box()"], kotlin: ["return Box()"] },
    SerialBox__get_length: { swift: ["return 1"], kotlin: ["return 1.0"] },
  },
};
const options = { fileName: "lifetimes.lucent.ts", libraries: { "@lucent-lang/sdk/buf": library } };

test("rejects a main-executor call from the caller executor", () => {
  const result = compile(
    'import {borrow} from "@lucent-lang/sdk/buf"; export function read():number { const buffer = borrow(); return buffer.length; }',
    options,
  );
  expect(result.module).toBeNull();
  expect(result.diagnostics.some((d) => d.code === "LUCENT1019")).toBe(true);
});

test("rejects returning or suspending a borrow, and use after close", () => {
  const returned = compile(
    'import {borrow, Buffer} from "@lucent-lang/sdk/buf"; @MainThread export async function leak(): Promise<Buffer> { return borrow(); }',
    options,
  );
  expect(returned.diagnostics.some((d) => d.code === "LUCENT1018")).toBe(true);
  const suspended = compile(
    'import {borrow} from "@lucent-lang/sdk/buf"; async function pause(): Promise<number> { return 1; } @MainThread export async function later(): Promise<number> { const buffer = borrow(); await pause(); return buffer.length; }',
    options,
  );
  expect(suspended.diagnostics.some((d) => d.message.includes("suspension"))).toBe(true);
  const closed = compile(
    'import {borrow} from "@lucent-lang/sdk/buf"; @MainThread export async function stop(): Promise<number> { const buffer = borrow(); buffer.close(); return buffer.length; }',
    options,
  );
  expect(closed.diagnostics.some((d) => d.message.includes("closed"))).toBe(true);
  const conditional = compile(
    'import {borrow} from "@lucent-lang/sdk/buf"; @MainThread export async function maybe(flag: boolean): Promise<number> { const buffer = borrow(); if (flag) { buffer.close(); } return buffer.length; }',
    options,
  );
  expect(conditional.diagnostics.some((d) => d.message.includes("closed"))).toBe(true);
});

test("allows a borrow used before suspension on the required executor", () => {
  const result = compile(
    'import {borrow} from "@lucent-lang/sdk/buf"; async function pause(): Promise<number> { return 1; } @MainThread export async function read(): Promise<number> { const buffer = borrow(); const length = buffer.length; await pause(); return length; }',
    options,
  );
  expect(result.diagnostics).toEqual([]);
});

test("rejects moving a serial object onto a worker", () => {
  const result = compile(
    'import {SerialBox} from "@lucent-lang/sdk/buf"; @Background export async function hop(): Promise<number> { const box = new SerialBox(); return box.length; }',
    options,
  );
  expect(result.diagnostics.some((d) => d.code === "LUCENT1019")).toBe(true);
});

test("records value and retained captures and accepts statement bodies", () => {
  const result = compile(
    'import type {NativeCallback} from "@lucent-lang/core/types"; import {SerialBox} from "@lucent-lang/sdk/buf"; function apply(value:number,callback:NativeCallback<(value:number)=>number>):number{return callback(value);} export function captured():number{ const factor=3; const box=new SerialBox(); return apply(1,(value:number):number=>{ const extra=value*factor; return extra+box.length; }); }',
    options,
  );
  expect(result.diagnostics).toEqual([]);
  const closure = JSON.stringify(result.module);
  expect(closure).toContain('"kind":"value"');
  expect(closure).toContain('"name":"factor"');
  expect(closure).toContain('"kind":"retained"');
  expect(closure).toContain('"name":"box"');
});
