import { expect, test } from "vite-plus/test";
import { compile } from "../src/index.ts";
import { expoHost } from "../../host-expo/src/index.ts";
import { nitroHost } from "../../host-nitro/src/index.ts";

test("native resources compile begin/end/close against the library", () => {
  const result = compile(
    `import {NativeResource} from '@lucent-lang/core/resources';
export function make():NativeResource{return new NativeResource();}
export function begin(resource:NativeResource):void{resource.beginOperation();}
export function end(resource:NativeResource):void{resource.endOperation();}
export async function close(resource:NativeResource):Promise<void>{await resource.close();}
export function leases(resource:NativeResource):number{return resource.leaseCount;}
export function isClosed(resource:NativeResource):boolean{return resource.closed;}`,
    { fileName: "resources.lucent.ts" },
  );
  expect(result.diagnostics).toEqual([]);
  expect(result.module).not.toBeNull();
  for (const host of [expoHost, nitroHost])
    expect(host.emitProxy(result.module!).dts).toContain("close(): Promise<void>");
  expect(Object.values(result.module!.nativePackages ?? {}).flatMap((p) => Object.keys(p.swift ?? {}))).toEqual([
    "Resource.swift",
  ]);
});

test("close after close is idempotent at the type level", () => {
  const result = compile(
    `import {NativeResource} from '@lucent-lang/core/resources';
export async function shutdown(resource:NativeResource):Promise<void>{
  await resource.close();
  await resource.close();
}`,
    { fileName: "resources-close.lucent.ts" },
  );
  expect(result.diagnostics).toEqual([]);
  expect(result.module).not.toBeNull();
});

test("rejects use after close other than idempotent close", () => {
  const result = compile(
    `import {NativeResource} from '@lucent-lang/core/resources';
export async function bad(resource:NativeResource):Promise<void>{
  await resource.close();
  resource.beginOperation();
}`,
    { fileName: "resources-use.lucent.ts" },
  );
  expect(result.diagnostics.some((d) => d.message.includes("closed"))).toBe(true);
});
