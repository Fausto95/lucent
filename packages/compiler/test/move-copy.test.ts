import { expect, test } from "vite-plus/test";
import { compile, type LibraryModule } from "../src/index.ts";
import { printIR } from "../src/ir/print.ts";

const bufLibrary: LibraryModule = {
  schemaVersion: 1,
  source: `export type Buffer = { length: number };
export declare function Buffer__create():Buffer;
export declare function Buffer__get_length(lucentSelf:Buffer):number;
export declare function Buffer__method_close(lucentSelf:Buffer):void;
export declare function borrow():Buffer;
export declare function take(buffer:Buffer):void;`,
  references: {
    Buffer: { swift: "Buf", kotlin: "Buf", contract: { ownership: "owned", executor: "caller", close: "close" } },
  },
  bindings: {
    Buffer__create: {
      contract: { symbolId: "buf.init", result: "owned", executor: "caller" },
      swift: ["return Buf()"],
      kotlin: ["return Buf()"],
    },
    Buffer__get_length: {
      contract: { symbolId: "buf.length", executor: "caller" },
      swift: ["return 1"],
      kotlin: ["return 1.0"],
    },
    Buffer__method_close: {
      contract: { symbolId: "buf.close", executor: "caller" },
      swift: ["lucentSelf.close()"],
      kotlin: ["lucentSelf.close()"],
    },
    borrow: {
      contract: { symbolId: "buf.borrow", result: "borrowed", executor: "caller" },
      swift: ["return Buf()"],
      kotlin: ["return Buf()"],
    },
    take: {
      contract: { symbolId: "buf.take", parameters: { buffer: { ownership: "retained" } }, executor: "caller" },
      swift: ["_ = buffer"],
      kotlin: ["buffer.hashCode()"],
    },
  },
};

const opts = { fileName: "move-copy.lucent.ts", libraries: { "@lucent-lang/sdk/buf": bufLibrary } };

test("move transfers ownership and rejects use-after-move", () => {
  const ok = compile(
    `import {Buffer,take} from '@lucent-lang/sdk/buf';
export function handoff():void{const owned=new Buffer();take(move(owned));}`,
    opts,
  );
  expect(ok.diagnostics).toEqual([]);
  expect(printIR(ok.module!)).toContain("(move ");

  const bad = compile(
    `import {Buffer,take} from '@lucent-lang/sdk/buf';
export function handoff():number{
  const owned=new Buffer();
  take(move(owned));
  return owned.length;
}`,
    opts,
  );
  expect(bad.diagnostics.some((d) => d.code === "LUCENT1018" && d.message.includes("moved"))).toBe(true);
});

test("move of a borrow is rejected", () => {
  const result = compile(
    `import {borrow,take} from '@lucent-lang/sdk/buf';
export function bad():void{const buffer=borrow();take(move(buffer));}`,
    opts,
  );
  expect(result.diagnostics.some((d) => d.code === "LUCENT1018" && d.message.includes("borrowed"))).toBe(true);
});

test("copy of scalars and bytes yields an owned value", () => {
  const scalars = compile(`export function twice(value:number):number{const owned=copy(value);return owned+owned;}`, {
    fileName: "copy-scalar.lucent.ts",
  });
  expect(scalars.diagnostics).toEqual([]);
  expect(printIR(scalars.module!)).toContain("(copy ");

  const bytes = compile(
    `import {encodeUTF8} from '@lucent-lang/core';
export function clone(text:string):Uint8Array{const bytes=encodeUTF8(text);return copy(bytes);}`,
    { fileName: "copy-bytes.lucent.ts" },
  );
  expect(bytes.diagnostics).toEqual([]);
  expect(printIR(bytes.module!)).toContain("(copy ");
});

test("copy rejects native reference types", () => {
  const result = compile(
    `import {Buffer} from '@lucent-lang/sdk/buf';
export function bad(buffer:Buffer):Buffer{return copy(buffer);}`,
    opts,
  );
  expect(result.diagnostics.some((d) => d.message.includes("`copy()`"))).toBe(true);
});
