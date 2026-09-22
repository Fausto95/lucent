import { expect, test } from "vite-plus/test";
import { compile } from "../src/index.ts";
import { printIR } from "../src/ir/print.ts";

test("withResource closes the resource on every exit path", () => {
  const result = compile(
    `import {NativeResource,withResource} from '@lucent-lang/core/resources';
export async function use():Promise<void>{
  const resource=new NativeResource();
  await withResource(resource,(r:NativeResource):void=>{r.beginOperation();r.endOperation();});
}`,
    { fileName: "with-resource.lucent.ts" },
  );
  expect(result.diagnostics).toEqual([]);
  expect(result.module).not.toBeNull();
  expect(printIR(result.module!)).toContain("withResource");
  expect(Object.values(result.module!.nativePackages ?? {}).flatMap((p) => Object.keys(p.swift ?? {}))).toContain(
    "Resource.swift",
  );
  const swift = Object.values(result.module!.nativePackages ?? {})
    .flatMap((p) => Object.values(p.swift ?? {}))
    .join("\n");
  expect(swift).toContain("LucentResourceScope");
});

test("withResource marks the resource closed for later uses", () => {
  const result = compile(
    `import {NativeResource,withResource} from '@lucent-lang/core/resources';
export async function bad():Promise<void>{
  const resource=new NativeResource();
  await withResource(resource,(r:NativeResource):void=>{});
  resource.beginOperation();
}`,
    { fileName: "with-resource-closed.lucent.ts" },
  );
  expect(result.diagnostics.some((d) => d.message.includes("closed"))).toBe(true);
});

test("resourceScope owns resources and closes them in reverse order", () => {
  const result = compile(
    `import {NativeResource,resourceScope} from '@lucent-lang/core/resources';
export async function use():Promise<void>{
  const first=new NativeResource();
  const second=new NativeResource();
  await resourceScope((scope):void=>{
    scope.own(first);
    scope.own(second);
    first.beginOperation();
    first.endOperation();
  });
}`,
    { fileName: "resource-scope.lucent.ts" },
  );
  expect(result.diagnostics).toEqual([]);
  expect(result.module).not.toBeNull();
  expect(printIR(result.module!)).toContain("resourceScope");
  const swift = Object.values(result.module!.nativePackages ?? {})
    .flatMap((p) => Object.values(p.swift ?? {}))
    .join("\n");
  expect(swift).toContain("LucentResourceBag");
  expect(swift).toContain("resourceScope");
});

test("resourceScope marks owned resources closed after the call", () => {
  const result = compile(
    `import {NativeResource,resourceScope} from '@lucent-lang/core/resources';
export async function bad():Promise<void>{
  const resource=new NativeResource();
  await resourceScope((scope):void=>{scope.own(resource);});
  resource.beginOperation();
}`,
    { fileName: "resource-scope-closed.lucent.ts" },
  );
  expect(result.diagnostics.some((d) => d.message.includes("closed"))).toBe(true);
});

test("ResourceScope.own and closeAll mark owned resources closed", () => {
  const result = compile(
    `import {NativeResource,ResourceScope} from '@lucent-lang/core/resources';
export async function bad():Promise<void>{
  const scope=new ResourceScope();
  const resource=new NativeResource();
  scope.own(resource);
  await scope.closeAll();
  resource.beginOperation();
}`,
    { fileName: "resource-scope-manual.lucent.ts" },
  );
  expect(result.diagnostics.some((d) => d.message.includes("closed"))).toBe(true);
});

test("withSubscription mirrors withResource", () => {
  const result = compile(
    `import {NativeSubscription,withSubscription} from '@lucent-lang/core/subscriptions';
export async function use():Promise<void>{
  const subscription=new NativeSubscription();
  await withSubscription(subscription,(s:NativeSubscription):void=>{s.beginDelivery();s.endDelivery();});
}`,
    { fileName: "with-subscription.lucent.ts" },
  );
  expect(result.diagnostics).toEqual([]);
  expect(result.module).not.toBeNull();
  const swift = Object.values(result.module!.nativePackages ?? {})
    .flatMap((p) => Object.values(p.swift ?? {}))
    .join("\n");
  expect(swift).toContain("LucentSubscriptionScope");
});
