import type { LibraryModule, NativeBinding } from "@lucent-lang/compiler";
import { nativeSymbolId } from "@lucent-lang/compiler";
import { nativeSource } from "./native-sources.generated.ts";

const symbol = (owner: string, name: string, abi: string) => nativeSymbolId("FakeSdk", owner, name, abi);

const callCallback = {
  ownership: "retained" as const,
  callback: { retention: "call" as const, executor: "caller" as const, errors: "propagate" as const },
};

const subscriptionCallback = {
  ownership: "retained" as const,
  callback: {
    retention: "subscription" as const,
    executor: "caller" as const,
    errors: "propagate" as const,
  },
};

const operations = {
  FakeBarrier__create: ["return FakeBarrier()", "return FakeBarrier()"],
  FakeBarrier__method_started: ["await lucentSelf.started()", "lucentSelf.started()"],
  FakeBarrier__method_complete: ["lucentSelf.complete()", "lucentSelf.complete()"],
  FakeResource__create: ["return FakeResource()", "return FakeResource()"],
  FakeResource__get_closed: ["return lucentSelf.closed", "return lucentSelf.closed"],
  FakeResource__get_closing: ["return lucentSelf.closing", "return lucentSelf.closing"],
  FakeResource__method_work: ["try await lucentSelf.work(barrier: barrier)", "lucentSelf.work(barrier)"],
  FakeResource__method_scheduleCallback: [
    "return try await lucentSelf.scheduleCallback(barrier: barrier, callback)",
    "return lucentSelf.scheduleCallback(barrier, callback)",
  ],
  FakeResource__method_notify: ["return try lucentSelf.notify(value)", "return lucentSelf.notify(value)"],
  FakeResource__method_clearListener: ["lucentSelf.clearListener()", "lucentSelf.clearListener()"],
  FakeResource__method_close: ["await lucentSelf.close()", "lucentSelf.close()"],
  FakeEventSource__create: ["return FakeEventSource()", "return FakeEventSource()"],
  FakeEventSource__get_closed: ["return lucentSelf.closed", "return lucentSelf.closed"],
  FakeEventSource__method_onEvent: ["return try lucentSelf.onEvent(callback)", "return lucentSelf.onEvent(callback)"],
  FakeEventSource__method_deliver: [
    "return try await lucentSelf.deliver(barrier: barrier, value: value)",
    "return lucentSelf.deliver(barrier, value)",
  ],
  FakeEventSource__method_close: ["await lucentSelf.close()", "lucentSelf.close()"],
  FakeSubscription__get_closed: ["return lucentSelf.closed", "return lucentSelf.closed"],
  FakeSubscription__get_closing: ["return lucentSelf.closing", "return lucentSelf.closing"],
  FakeSubscription__method_close: ["await lucentSelf.close()", "lucentSelf.close()"],
  FakeUIObject__create: ["return FakeUIObject()", "return FakeUIObject()"],
  FakeUIObject__method_ping: ["return lucentSelf.ping()", "return lucentSelf.ping()"],
  FakeCounters__create: ["return FakeCounters()", "return FakeCounters()"],
  FakeCounters__method_snapshot: ["return lucentSelf.snapshot()", "return lucentSelf.snapshot()"],
  CounterSnapshot__create: ["return FakeCounterSnapshot()", "return FakeCounterSnapshot()"],
  CounterSnapshot__get_handles: ["return lucentSelf.handles", "return lucentSelf.handles"],
  CounterSnapshot__get_resources: ["return lucentSelf.resources", "return lucentSelf.resources"],
  CounterSnapshot__get_leases: ["return lucentSelf.leases", "return lucentSelf.leases"],
  CounterSnapshot__get_delegates: ["return lucentSelf.delegates", "return lucentSelf.delegates"],
  CounterSnapshot__get_callbacks: ["return lucentSelf.callbacks", "return lucentSelf.callbacks"],
  CounterSnapshot__get_tasks: ["return lucentSelf.tasks", "return lucentSelf.tasks"],
  CounterSnapshot__get_buffers: ["return lucentSelf.buffers", "return lucentSelf.buffers"],
  CounterSnapshot__get_subscriptions: ["return lucentSelf.subscriptions", "return lucentSelf.subscriptions"],
  createBorrowedBuffer: [
    "return try FakeSdk.createBorrowedBuffer(bytes: bytes)",
    "return FakeSdk.createBorrowedBuffer(bytes)",
  ],
  registerListener: [
    "return try FakeSdk.registerListener(resource: resource, callback, mode: mode)",
    "return FakeSdk.registerListener(resource, callback, mode)",
  ],
  callSync: ["return try FakeSdk.callSync(callback)", "return FakeSdk.callSync(callback)"],
  callAsync: [
    "return try await FakeSdk.callAsync(barrier: barrier, callback)",
    "return FakeSdk.callAsync(barrier, callback)",
  ],
} as const;

const ownedCreates = new Set([
  "FakeBarrier__create",
  "FakeResource__create",
  "FakeEventSource__create",
  "FakeUIObject__create",
  "FakeCounters__create",
  "CounterSnapshot__create",
  "FakeCounters__method_snapshot",
  "FakeEventSource__method_onEvent",
  "registerListener",
]);

const callbackParams: Record<string, Record<string, typeof callCallback | typeof subscriptionCallback>> = {
  FakeResource__method_scheduleCallback: { callback: callCallback },
  FakeEventSource__method_onEvent: { callback: subscriptionCallback },
  registerListener: { callback: subscriptionCallback },
  callSync: { callback: callCallback },
  callAsync: { callback: callCallback },
};

const bindings: Record<string, NativeBinding> = Object.fromEntries(
  Object.entries(operations).map(([name, [swift, kotlin]]) => [
    name,
    {
      contract: {
        symbolId: symbol(name.split("__")[0]!, name, "v1"),
        ...(ownedCreates.has(name) ? { result: "owned" as const } : {}),
        ...(name === "createBorrowedBuffer" ? { result: "borrowed" as const } : {}),
        ...(name === "FakeResource__method_work" || name === "FakeResource__method_scheduleCallback"
          ? { cancellation: "cooperative" as const }
          : {}),
        ...(name === "FakeUIObject__create" || name === "FakeUIObject__method_ping"
          ? { executor: "main" as const }
          : {}),
        ...(callbackParams[name] ? { parameters: callbackParams[name] } : {}),
      },
      ...(name === "FakeEventSource__method_onEvent" ||
      name === "FakeResource__method_scheduleCallback" ||
      name === "registerListener" ||
      name === "callSync" ||
      name === "callAsync"
        ? { nativeOnly: true }
        : {}),
      swift: [swift],
      kotlin: [kotlin],
    },
  ]),
);

/** Deterministic native test SDK — pass via `compile({ libraries })`, not STANDARD_LIBRARIES. */
export const FAKE_SDK_LIBRARY: LibraryModule = {
  schemaVersion: 1,
  source: `import type {NativeCallback} from '@lucent-lang/core/types';
export type DelegateMode = "weak" | "retained";
export type FakeBarrier = {};
export type FakeResource = { closed: boolean; closing: boolean };
export type FakeListener = {};
export type FakeEventSource = { closed: boolean };
export type FakeSubscription = { closed: boolean; closing: boolean };
export type FakeUIObject = {};
export type CounterSnapshot = {
  handles: number;
  resources: number;
  leases: number;
  delegates: number;
  callbacks: number;
  tasks: number;
  buffers: number;
  subscriptions: number;
};
export type FakeCounters = {};
export declare function FakeBarrier__create(): FakeBarrier;
export declare function FakeBarrier__method_started(lucentSelf: FakeBarrier): Promise<void>;
export declare function FakeBarrier__method_complete(lucentSelf: FakeBarrier): void;
export declare function FakeResource__create(): FakeResource;
export declare function FakeResource__get_closed(lucentSelf: FakeResource): boolean;
export declare function FakeResource__get_closing(lucentSelf: FakeResource): boolean;
export declare function FakeResource__method_work(lucentSelf: FakeResource, barrier: FakeBarrier): Promise<void>;
export declare function FakeResource__method_scheduleCallback(lucentSelf: FakeResource, barrier: FakeBarrier, callback: NativeCallback<() => number>): Promise<number>;
export declare function FakeResource__method_notify(lucentSelf: FakeResource, value: number): number;
export declare function FakeResource__method_clearListener(lucentSelf: FakeResource): void;
export declare function FakeResource__method_close(lucentSelf: FakeResource): Promise<void>;
export declare function FakeEventSource__create(): FakeEventSource;
export declare function FakeEventSource__get_closed(lucentSelf: FakeEventSource): boolean;
export declare function FakeEventSource__method_onEvent(lucentSelf: FakeEventSource, callback: NativeCallback<(value: number) => number>): FakeSubscription;
export declare function FakeEventSource__method_deliver(lucentSelf: FakeEventSource, barrier: FakeBarrier, value: number): Promise<number>;
export declare function FakeEventSource__method_close(lucentSelf: FakeEventSource): Promise<void>;
export declare function FakeSubscription__get_closed(lucentSelf: FakeSubscription): boolean;
export declare function FakeSubscription__get_closing(lucentSelf: FakeSubscription): boolean;
export declare function FakeSubscription__method_close(lucentSelf: FakeSubscription): Promise<void>;
export declare function FakeUIObject__create(): FakeUIObject;
export declare function FakeUIObject__method_ping(lucentSelf: FakeUIObject): number;
export declare function FakeCounters__create(): FakeCounters;
export declare function FakeCounters__method_snapshot(lucentSelf: FakeCounters): CounterSnapshot;
export declare function CounterSnapshot__create(): CounterSnapshot;
export declare function CounterSnapshot__get_handles(lucentSelf: CounterSnapshot): number;
export declare function CounterSnapshot__get_resources(lucentSelf: CounterSnapshot): number;
export declare function CounterSnapshot__get_leases(lucentSelf: CounterSnapshot): number;
export declare function CounterSnapshot__get_delegates(lucentSelf: CounterSnapshot): number;
export declare function CounterSnapshot__get_callbacks(lucentSelf: CounterSnapshot): number;
export declare function CounterSnapshot__get_tasks(lucentSelf: CounterSnapshot): number;
export declare function CounterSnapshot__get_buffers(lucentSelf: CounterSnapshot): number;
export declare function CounterSnapshot__get_subscriptions(lucentSelf: CounterSnapshot): number;
export declare function createBorrowedBuffer(bytes: number): Uint8Array;
export declare function registerListener(resource: FakeResource, callback: NativeCallback<(value: number) => number>, mode: DelegateMode): FakeListener;
export declare function callSync(callback: NativeCallback<() => number>): number;
export declare function callAsync(barrier: FakeBarrier, callback: NativeCallback<() => number>): Promise<number>;`,
  enums: {
    DelegateMode: {
      cases: ["weak", "retained"],
      swift: {
        type: "String",
        values: { weak: '"weak"', retained: '"retained"' },
      },
      kotlin: {
        type: "String",
        values: { weak: '"weak"', retained: '"retained"' },
      },
    },
  },
  references: {
    FakeBarrier: {
      swift: "FakeBarrier",
      kotlin: "FakeBarrier",
      contract: { ownership: "owned", executor: "caller", transferable: true },
    },
    FakeResource: {
      swift: "FakeResource",
      kotlin: "FakeResource",
      contract: { ownership: "owned", executor: "caller", transferable: true, close: "close" },
    },
    FakeListener: {
      nativeOnly: true,
      swift: "FakeListener",
      kotlin: "FakeListener",
      contract: { ownership: "owned", executor: "caller", transferable: true },
    },
    FakeEventSource: {
      swift: "FakeEventSource",
      kotlin: "FakeEventSource",
      contract: { ownership: "owned", executor: "caller", transferable: true, close: "close" },
    },
    FakeSubscription: {
      nativeOnly: true,
      swift: "FakeSubscription",
      kotlin: "FakeSubscription",
      contract: { ownership: "owned", executor: "caller", transferable: true, close: "close" },
    },
    FakeUIObject: {
      swift: "FakeUIObject",
      kotlin: "FakeUIObject",
      contract: { ownership: "owned", executor: "main", transferable: false },
    },
    FakeCounters: {
      swift: "FakeCounters",
      kotlin: "FakeCounters",
      contract: { ownership: "owned", executor: "caller", transferable: true },
    },
    CounterSnapshot: {
      swift: "FakeCounterSnapshot",
      kotlin: "FakeCounterSnapshot",
      contract: { ownership: "owned", executor: "caller", transferable: true },
    },
  },
  bindings,
  native: {
    swift: { "FakeSdk.swift": nativeSource("FakeSdk.swift") },
    kotlin: { "FakeSdk.kt": nativeSource("FakeSdk.kt") },
  },
};
