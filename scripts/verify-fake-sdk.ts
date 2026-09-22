/**
 * Compile Lucent against FAKE_SDK_LIBRARY and race close / late callbacks /
 * subscription quiescence on both toolchains.
 *
 * Harness runners are hand-written under scripts/native/verify-fake-sdk/ and
 * filled with fillNative; assembly uses @lucent-lang/codegen (no TS template
 * literals for braces or indentation).
 */
import { compile } from "../packages/compiler/src/index.ts";
import { generateSwift, swiftRuntime } from "../packages/backend-swift/src/index.ts";
import { generateKotlin, kotlinRuntime } from "../packages/backend-kotlin/src/index.ts";
import { FAKE_SDK_LIBRARY } from "../packages/fake-sdk/src/library.ts";
import {
  compileAndRunKotlin,
  compileAndRunSwift,
  fillVerifyHarness,
  packageSources,
  readNativeTemplate,
} from "./lib/verify-harness.ts";

const libraries = { "@lucent-lang/fake-sdk": FAKE_SDK_LIBRARY };

const lucent = `import type {NativeCallback} from '@lucent-lang/core/types';
import {
  FakeBarrier, FakeResource, FakeCounters, FakeEventSource, FakeSubscription, FakeListener,
  CounterSnapshot, DelegateMode, registerListener,
  callSync as sdkCallSync, callAsync as sdkCallAsync
} from '@lucent-lang/fake-sdk';

export function makeBarrier(): FakeBarrier { return new FakeBarrier(); }
export function makeResource(): FakeResource { return new FakeResource(); }
export function makeCounters(): FakeCounters { return new FakeCounters(); }
export function makeEventSource(): FakeEventSource { return new FakeEventSource(); }
export function snapshot(counters: FakeCounters): CounterSnapshot { return counters.snapshot(); }
export async function awaitStarted(barrier: FakeBarrier): Promise<void> { await barrier.started(); }
export function completeBarrier(barrier: FakeBarrier): void { barrier.complete(); }
export async function runWork(resource: FakeResource, barrier: FakeBarrier): Promise<void> {
  await resource.work(barrier);
}
export async function closeResource(resource: FakeResource): Promise<void> { await resource.close(); }
export function resourceClosed(resource: FakeResource): boolean { return resource.closed; }
export function resourceClosing(resource: FakeResource): boolean { return resource.closing; }
@NativeOnly export async function schedule(
  resource: FakeResource,
  barrier: FakeBarrier,
  callback: NativeCallback<() => number>,
): Promise<number> {
  return await resource.scheduleCallback(barrier, callback);
}
@NativeOnly export function register(
  resource: FakeResource,
  callback: NativeCallback<(value: number) => number>,
  mode: DelegateMode,
): FakeListener {
  return registerListener(resource, callback, mode);
}
export function notify(resource: FakeResource, value: number): number { return resource.notify(value); }
@NativeOnly export function callSync(callback: NativeCallback<() => number>): number {
  return sdkCallSync(callback);
}
@NativeOnly export async function callAsync(
  barrier: FakeBarrier,
  callback: NativeCallback<() => number>,
): Promise<number> {
  return await sdkCallAsync(barrier, callback);
}
@NativeOnly export function onEvent(
  source: FakeEventSource,
  callback: NativeCallback<(value: number) => number>,
): FakeSubscription {
  return source.onEvent(callback);
}
export async function deliver(
  source: FakeEventSource,
  barrier: FakeBarrier,
  value: number,
): Promise<number> {
  return await source.deliver(barrier, value);
}
@NativeOnly export async function closeSubscription(subscription: FakeSubscription): Promise<void> {
  await subscription.close();
}
@NativeOnly export function subscriptionClosed(subscription: FakeSubscription): boolean {
  return subscription.closed;
}
@NativeOnly export function subscriptionClosing(subscription: FakeSubscription): boolean {
  return subscription.closing;
}
export async function closeEventSource(source: FakeEventSource): Promise<void> { await source.close(); }`;

const compiled = compile(lucent, { fileName: "fake-sdk.lucent.ts", libraries });
if (!compiled.module) throw new Error(JSON.stringify(compiled.diagnostics));
const ir = compiled.module;

const runtimeSwift = swiftRuntime({
  length: "return Double(buffer.count)",
  get: "return Double(buffer[Int(index)])",
});
const runtimeKotlin = kotlinRuntime({
  imports: [],
  length: "return buffer.size.toDouble()",
  get: "return buffer[index.toInt()].toDouble()",
});

const swiftSource = fillVerifyHarness(readNativeTemplate("verify-fake-sdk", "Runner.swift"), {
  runtime: runtimeSwift,
  packages: packageSources(ir, "swift"),
  generated: generateSwift(ir).code,
});
compileAndRunSwift(swiftSource, "lucent-fake-sdk-");

const kotlinSource = fillVerifyHarness(readNativeTemplate("verify-fake-sdk", "Main.kt"), {
  runtime: runtimeKotlin,
  packages: packageSources(ir, "kotlin"),
  generated: generateKotlin(ir).code,
});
compileAndRunKotlin(kotlinSource, "lucent-fake-sdk-");
