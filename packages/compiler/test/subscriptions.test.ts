import { expect, test } from "vite-plus/test";
import { compile } from "../src/index.ts";
import { expoHost } from "../../host-expo/src/index.ts";
import { nitroHost } from "../../host-nitro/src/index.ts";

test("native subscriptions compile begin/end/close against the library", () => {
  const result = compile(
    `import {NativeSubscription} from '@lucent-lang/core/subscriptions';
export function make():NativeSubscription{return new NativeSubscription();}
export function begin(subscription:NativeSubscription):void{subscription.beginDelivery();}
export function end(subscription:NativeSubscription):void{subscription.endDelivery();}
export async function close(subscription:NativeSubscription):Promise<void>{await subscription.close();}
export function active(subscription:NativeSubscription):number{return subscription.activeCallbackCount;}
export function isClosed(subscription:NativeSubscription):boolean{return subscription.closed;}`,
    { fileName: "subscriptions.lucent.ts" },
  );
  expect(result.diagnostics).toEqual([]);
  expect(result.module).not.toBeNull();
  for (const host of [expoHost, nitroHost])
    expect(host.emitProxy(result.module!).dts).toContain("close(): Promise<void>");
  expect(Object.values(result.module!.nativePackages ?? {}).flatMap((p) => Object.keys(p.swift ?? {}))).toEqual([
    "Subscription.swift",
  ]);
});

test("close after close is idempotent at the type level", () => {
  const result = compile(
    `import {NativeSubscription} from '@lucent-lang/core/subscriptions';
export async function shutdown(subscription:NativeSubscription):Promise<void>{
  await subscription.close();
  await subscription.close();
}`,
    { fileName: "subscriptions-close.lucent.ts" },
  );
  expect(result.diagnostics).toEqual([]);
  expect(result.module).not.toBeNull();
});
