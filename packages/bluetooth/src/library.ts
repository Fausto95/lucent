import type { LibraryModule, NativeBinding } from "@lucent-lang/compiler";
import { nativeSymbolId } from "@lucent-lang/compiler";
import { nativeSource } from "./native-sources.generated.ts";

const symbol = (owner: string, name: string, abi: string) => nativeSymbolId("Bluetooth", owner, name, abi);

/**
 * Package policy for `notifications`: bounded buffer of capacity 32 (buffer(n)).
 * The compiler callback contract carries `backpressure: "block"` (lossless /
 * wait-when-full). The CI stub delivers synchronously and does not queue yet.
 */
export const NOTIFICATION_BUFFER_CAPACITY = 32;

const notificationsCallbackContract = {
  ownership: "retained" as const,
  callback: {
    retention: "subscription" as const,
    executor: "worker" as const,
    errors: "notify" as const,
    backpressure: "block" as const,
  },
};

const operations = {
  BluetoothScanner__create: ["return LucentBluetoothScanner()", "return LucentBluetoothScanner()"],
  BluetoothScanner__get_closed: ["return lucentSelf.closed", "return lucentSelf.closed"],
  BluetoothScanner__method_start: ["try lucentSelf.start()", "lucentSelf.start()"],
  BluetoothScanner__method_stop: ["lucentSelf.stop()", "lucentSelf.stop()"],
  BluetoothScanner__method_enqueueScanResult: [
    "try lucentSelf.enqueueScanResult(peripheralId: peripheralId)",
    "lucentSelf.enqueueScanResult(peripheralId)",
  ],
  BluetoothScanner__method_pollScanResult: [
    "return try lucentSelf.pollScanResult()",
    "return lucentSelf.pollScanResult()",
  ],
  BluetoothScanner__method_connect: [
    "return try await lucentSelf.connect(peripheralId: peripheralId)",
    "return lucentSelf.connect(peripheralId)",
  ],
  BluetoothScanner__method_close: ["await lucentSelf.close()", "lucentSelf.close()"],
  BluetoothConnection__get_closed: ["return lucentSelf.closed", "return lucentSelf.closed"],
  BluetoothConnection__get_connectionState: ["return lucentSelf.connectionState", "return lucentSelf.connectionState"],
  BluetoothConnection__method_read: [
    "return try await lucentSelf.read(characteristic: characteristic)",
    "return lucentSelf.read(characteristic)",
  ],
  /** CI-only borrowed view of a characteristic payload; must not escape the call. */
  BluetoothConnection__method_borrowRead: [
    "return try await lucentSelf.read(characteristic: characteristic)",
    "return lucentSelf.read(characteristic)",
  ],
  BluetoothConnection__method_write: [
    "try await lucentSelf.write(characteristic: characteristic, payload: payload)",
    "lucentSelf.write(characteristic, payload)",
  ],
  BluetoothConnection__method_notifications: [
    "return try lucentSelf.notifications(characteristic: characteristic, callback: callback)",
    "return lucentSelf.notifications(characteristic, callback)",
  ],
  BluetoothConnection__method_deliverNotification: [
    "return try lucentSelf.deliverNotification(characteristic: characteristic, payload: payload)",
    "return lucentSelf.deliverNotification(characteristic, payload)",
  ],
  BluetoothConnection__method_close: ["await lucentSelf.close()", "lucentSelf.close()"],
} as const;

const ownedCreates = new Set(["BluetoothScanner__create", "BluetoothScanner__method_connect"]);
const borrowedResults = new Set(["BluetoothConnection__method_borrowRead"]);

const bindings: Record<string, NativeBinding> = Object.fromEntries(
  Object.entries(operations).map(([name, [swift, kotlin]]) => [
    name,
    {
      contract: {
        symbolId: symbol(name.split("__")[0]!, name, "v1"),
        ...(ownedCreates.has(name) ? { result: "owned" as const } : {}),
        ...(borrowedResults.has(name) ? { result: "borrowed" as const } : {}),
        ...(name === "BluetoothConnection__method_notifications"
          ? { parameters: { callback: notificationsCallbackContract } }
          : {}),
        ...(name.endsWith("__method_close") ? { cancellation: "cooperative" as const } : {}),
      },
      ...(name === "BluetoothConnection__method_deliverNotification" ||
      name === "BluetoothConnection__method_notifications" ||
      name === "BluetoothConnection__method_borrowRead" ||
      name === "BluetoothScanner__method_enqueueScanResult"
        ? { nativeOnly: true }
        : {}),
      swift: [swift],
      kotlin: [kotlin],
    },
  ]),
);

/** Bluetooth acceptance package — FakeSdk-style CI stubs with fake peripherals. */
export const BLUETOOTH_LIBRARY: LibraryModule = {
  schemaVersion: 1,
  source: `import type {NativeCallback} from '@lucent-lang/core/types';
export type ConnectionState = "connecting" | "connected" | "disconnecting" | "disconnected";
export type BluetoothScanner = { closed: boolean };
export type BluetoothConnection = { closed: boolean };
export declare function BluetoothScanner__create(): BluetoothScanner;
export declare function BluetoothScanner__get_closed(lucentSelf: BluetoothScanner): boolean;
export declare function BluetoothScanner__method_start(lucentSelf: BluetoothScanner): void;
export declare function BluetoothScanner__method_stop(lucentSelf: BluetoothScanner): void;
export declare function BluetoothScanner__method_enqueueScanResult(lucentSelf: BluetoothScanner, peripheralId: string): void;
export declare function BluetoothScanner__method_pollScanResult(lucentSelf: BluetoothScanner): string;
export declare function BluetoothScanner__method_connect(lucentSelf: BluetoothScanner, peripheralId: string): Promise<BluetoothConnection>;
export declare function BluetoothScanner__method_close(lucentSelf: BluetoothScanner): Promise<void>;
export declare function BluetoothConnection__get_closed(lucentSelf: BluetoothConnection): boolean;
export declare function BluetoothConnection__get_connectionState(lucentSelf: BluetoothConnection): ConnectionState;
export declare function BluetoothConnection__method_read(lucentSelf: BluetoothConnection, characteristic: string): Promise<Uint8Array>;
export declare function BluetoothConnection__method_borrowRead(lucentSelf: BluetoothConnection, characteristic: string): Promise<Uint8Array>;
export declare function BluetoothConnection__method_write(lucentSelf: BluetoothConnection, characteristic: string, payload: Uint8Array): Promise<void>;
export declare function BluetoothConnection__method_notifications(lucentSelf: BluetoothConnection, characteristic: string, callback: NativeCallback<(payload: Uint8Array) => number>): number;
export declare function BluetoothConnection__method_deliverNotification(lucentSelf: BluetoothConnection, characteristic: string, payload: Uint8Array): number;
export declare function BluetoothConnection__method_close(lucentSelf: BluetoothConnection): Promise<void>;`,
  enums: {
    ConnectionState: {
      cases: ["connecting", "connected", "disconnecting", "disconnected"],
      swift: {
        type: "String",
        values: {
          connecting: '"connecting"',
          connected: '"connected"',
          disconnecting: '"disconnecting"',
          disconnected: '"disconnected"',
        },
      },
      kotlin: {
        type: "String",
        values: {
          connecting: '"connecting"',
          connected: '"connected"',
          disconnecting: '"disconnecting"',
          disconnected: '"disconnected"',
        },
      },
    },
  },
  references: {
    BluetoothScanner: {
      nativeOnly: true,
      swift: "LucentBluetoothScanner",
      kotlin: "LucentBluetoothScanner",
      contract: { ownership: "owned", executor: "caller", transferable: true, close: "close" },
    },
    BluetoothConnection: {
      nativeOnly: true,
      swift: "LucentBluetoothConnection",
      kotlin: "LucentBluetoothConnection",
      contract: { ownership: "owned", executor: "caller", transferable: true, close: "close" },
    },
  },
  bindings,
  native: {
    capabilities: ["bluetooth"],
    swift: { "Bluetooth.swift": nativeSource("Bluetooth.swift") },
    kotlin: { "Bluetooth.kt": nativeSource("Bluetooth.kt") },
  },
};
