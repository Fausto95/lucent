import { expect, test } from "vite-plus/test";
import { compile, validateLibrary } from "@lucent-lang/compiler";
import { FAKE_SDK_LIBRARY } from "../src/library.ts";
import { emptySnapshot, LiveCounters } from "../src/counters.ts";

const libraries = { "@lucent-lang/fake-sdk": FAKE_SDK_LIBRARY };

test("FAKE_SDK_LIBRARY passes validation", () => {
  expect(validateLibrary(FAKE_SDK_LIBRARY)).toEqual([]);
});

test("compiles barrier, resource, subscription, callbacks, and UI object", () => {
  const result = compile(
    `import type {NativeCallback} from '@lucent-lang/core/types';
import {
  FakeBarrier, FakeResource, FakeCounters, FakeEventSource, FakeSubscription,
  FakeUIObject, registerListener, callSync, callAsync, createBorrowedBuffer
} from '@lucent-lang/fake-sdk';

export function bufferSize(): number {
  return createBorrowedBuffer(4).length;
}

@NativeOnly export async function race(): Promise<number> {
  const barrier = new FakeBarrier();
  const resource = new FakeResource();
  const counters = new FakeCounters();
  registerListener(resource, (value: number): number => value + 1, "retained");
  const notified = resource.notify(3);
  await resource.work(barrier);
  await barrier.started();
  barrier.complete();
  const sync = callSync((): number => 1);
  const asyncValue = await callAsync(barrier, (): number => 2);
  const source = new FakeEventSource();
  const subscription = source.onEvent((value: number): number => value);
  await subscription.close();
  await source.close();
  await resource.close();
  const snap = counters.snapshot();
  return notified + sync + asyncValue + snap.handles + snap.subscriptions;
}

@MainThread export async function uiPing(): Promise<number> {
  const ui = new FakeUIObject();
  return ui.ping();
}`,
    { fileName: "fake-sdk.lucent.ts", libraries },
  );
  expect(result.diagnostics).toEqual([]);
  expect(result.module).not.toBeNull();
  expect(Object.values(result.module!.nativePackages ?? {}).flatMap((p) => Object.keys(p.swift ?? {}))).toContain(
    "FakeSdk.swift",
  );
});

test("rejects FakeUIObject.ping off the main executor", () => {
  const result = compile(
    `import {FakeUIObject} from '@lucent-lang/fake-sdk';
export function bad(): number {
  const ui = new FakeUIObject();
  return ui.ping();
}`,
    { fileName: "fake-ui.lucent.ts", libraries },
  );
  expect(result.module).toBeNull();
  expect(result.diagnostics.some((d) => d.code === "LUCENT1019")).toBe(true);
});

test("callback contracts are present for sync, async, listeners, and events", () => {
  expect(FAKE_SDK_LIBRARY.bindings!.callSync!.contract!.parameters!.callback!.callback!.retention).toBe("call");
  expect(FAKE_SDK_LIBRARY.bindings!.callAsync!.contract!.parameters!.callback!.callback!.retention).toBe("call");
  expect(FAKE_SDK_LIBRARY.bindings!.registerListener!.contract!.parameters!.callback!.callback!.retention).toBe(
    "subscription",
  );
  expect(
    FAKE_SDK_LIBRARY.bindings!.FakeEventSource__method_onEvent!.contract!.parameters!.callback!.callback!.retention,
  ).toBe("subscription");
  expect(FAKE_SDK_LIBRARY.references!.FakeUIObject!.contract!.executor).toBe("main");
});

test("LiveCounters tracks subscriptions and resets", () => {
  const counters = new LiveCounters();
  expect(counters.snapshot()).toEqual(emptySnapshot());
  counters.adjust("resources", 1);
  counters.adjust("leases", 2);
  counters.adjust("delegates", 1);
  counters.adjust("callbacks", 1);
  counters.adjust("subscriptions", 3);
  expect(counters.snapshot()).toEqual({
    ...emptySnapshot(),
    resources: 1,
    leases: 2,
    delegates: 1,
    callbacks: 1,
    subscriptions: 3,
  });
  counters.reset();
  expect(counters.snapshot()).toEqual(emptySnapshot());
});
