import { expect, test } from "vite-plus/test";
import { compile } from "../src/index.ts";
import { expoHost } from "../../host-expo/src/index.ts";
import { nitroHost } from "../../host-nitro/src/index.ts";

test("cells compile create, get, and set against the library", () => {
  const result = compile(
    `import {Cell} from '@lucent-lang/core/cells';
export function make(initial:number):Cell{return new Cell(initial);}
export function read(cell:Cell):number{return cell.value;}
export function write(cell:Cell,next:number):void{cell.value=next;}
export function bump(cell:Cell):number{cell.value=cell.value+1;return cell.value;}`,
    { fileName: "cells.lucent.ts" },
  );
  expect(result.diagnostics).toEqual([]);
  expect(result.module).not.toBeNull();
  for (const host of [expoHost, nitroHost]) expect(host.emitProxy(result.module!).dts).toContain("value: number");
  expect(Object.values(result.module!.nativePackages ?? {}).flatMap((p) => Object.keys(p.swift ?? {}))).toEqual([
    "Cells.swift",
  ]);
});

test("owned cells may be retained by native closures for mutable capture", () => {
  const result = compile(
    `import type {NativeCallback} from '@lucent-lang/core/types';
import {Cell} from '@lucent-lang/core/cells';
function apply(callback:NativeCallback<()=>number>):number{return callback();}
export function counted():number{
  const cell=new Cell(0);
  return apply(():number=>{cell.value=cell.value+1;return cell.value;});
}`,
    { fileName: "cells-capture.lucent.ts" },
  );
  expect(result.diagnostics).toEqual([]);
  expect(JSON.stringify(result.module)).toContain('"kind":"retained"');
});
