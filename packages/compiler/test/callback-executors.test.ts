import { expect, test } from "vite-plus/test";
import { compile, type LibraryModule } from "../src/index.ts";
const library: LibraryModule = {
  source: `import type {NativeCallback} from '@lucent-lang/core/types';
export declare function readUI():number;
export declare function background(callback:NativeCallback<()=>number>):void;
export declare function main(callback:NativeCallback<()=>number>):void;
export declare function inline(callback:NativeCallback<()=>number>):number;`,
  bindings: {
    readUI: {
      nativeOnly: true,
      contract: { symbolId: "ui", executor: "main" },
      swift: ["return 1"],
      kotlin: ["return 1.0"],
    },
    background: {
      nativeOnly: true,
      contract: {
        symbolId: "background",
        parameters: {
          callback: {
            ownership: "retained",
            callback: { retention: "subscription", executor: "worker", errors: "propagate" },
          },
        },
      },
      swift: [],
      kotlin: [],
    },
    main: {
      nativeOnly: true,
      contract: {
        symbolId: "main",
        parameters: {
          callback: {
            ownership: "retained",
            callback: { retention: "subscription", executor: "main", errors: "propagate" },
          },
        },
      },
      swift: [],
      kotlin: [],
    },
    inline: {
      nativeOnly: true,
      contract: {
        symbolId: "inline",
        parameters: {
          callback: { ownership: "value", callback: { retention: "call", executor: "caller", errors: "propagate" } },
        },
      },
      swift: ["return try callback()"],
      kotlin: ["return callback()"],
    },
  },
};
const run = (source: string) =>
  compile(
    `import type {NativeCallback} from '@lucent-lang/core/types'; import {readUI,background,main,inline} from '@sdk/callback-executors'; ${source}`,
    { fileName: "callback-executors.lucent.ts", libraries: { "@sdk/callback-executors": library } },
  );
test("contextual callback bodies use delivery executor rather than registration executor", () => {
  const bad = run("@MainThread export async function register():Promise<void>{background(():number=>readUI());}");
  expect(bad.module).toBeNull();
  expect(bad.diagnostics.some((d) => d.code === "LUCENT1019")).toBe(true);
  expect(run("export function register():void{main(():number=>readUI());}").diagnostics).toEqual([]);
});
test.each([
  "export function wrong():number{const callback=readUI;return callback();}",
  "export function wrong():number{const callback:NativeCallback<()=>number>=readUI;return callback();}",
  "export function wrong():void{const callback:NativeCallback<()=>number>=readUI;background(callback);}",
  "function factory():NativeCallback<()=>number>{return readUI;} export function wrong():number{return 0;}",
])("callback aliases cannot erase executor requirements: %s", (source) => {
  const result = run(source);
  expect(result.module).toBeNull();
  expect(result.diagnostics.some((d) => d.code === "LUCENT1019" || d.code === "LUCENT1011")).toBe(true);
});
test("indirect calls and nonescaping callbacks preserve the current executor", () => {
  expect(
    run(
      "@MainThread export async function read():Promise<number>{const callback:NativeCallback<()=>number>=readUI;return inline(callback);}",
    ).diagnostics,
  ).toEqual([]);
  expect(
    run("@MainThread export async function read():Promise<number>{const callback=readUI;return callback();}")
      .diagnostics,
  ).toEqual([]);
});
test("an executor-bound callback can be forwarded to a matching subscription", () => {
  expect(run("export function register():void{const callback=readUI;main(callback);}").diagnostics).toEqual([]);
});
