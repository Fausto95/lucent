import type { LibraryModule, NativeBinding } from "@lucent-lang/compiler";
import { nativeSymbolId } from "@lucent-lang/compiler";
import { nativeSource } from "./native-sources.generated.ts";

const symbol = (owner: string, name: string, abi: string) => nativeSymbolId("Location", owner, name, abi);

/** Keep-latest is the location package backpressure policy for `updates`. */
const updatesCallbackContract = {
  ownership: "retained" as const,
  callback: {
    retention: "subscription" as const,
    executor: "worker" as const,
    errors: "notify" as const,
    backpressure: "latest" as const,
  },
};

const operations = {
  LocationProvider__create: ["return LucentLocationProvider()", "return LucentLocationProvider()"],
  LocationProvider__get_closed: ["return lucentSelf.closed", "return lucentSelf.closed"],
  LocationProvider__method_updates: ["return try lucentSelf.updates(callback)", "return lucentSelf.updates(callback)"],
  LocationProvider__method_deliverFake: [
    "return try lucentSelf.deliverFake(latitude: latitude, longitude: longitude, accuracy: accuracy, timestamp: timestamp)",
    "return lucentSelf.deliverFake(latitude, longitude, accuracy, timestamp)",
  ],
  LocationProvider__method_staleDrops: ["return lucentSelf.staleDrops()", "return lucentSelf.staleDrops()"],
  LocationProvider__method_duplicateDrops: ["return lucentSelf.duplicateDrops()", "return lucentSelf.duplicateDrops()"],
  LocationProvider__method_close: ["await lucentSelf.close()", "lucentSelf.close()"],
  Position__get_latitude: ["return lucentSelf.latitude", "return lucentSelf.latitude"],
  Position__get_longitude: ["return lucentSelf.longitude", "return lucentSelf.longitude"],
  Position__get_accuracy: ["return lucentSelf.accuracy", "return lucentSelf.accuracy"],
  Position__get_timestamp: ["return lucentSelf.timestamp", "return lucentSelf.timestamp"],
  requestPermission: ["return LucentLocation.requestPermission()", "return LucentLocation.requestPermission()"],
  permissionState: ["return LucentLocation.permissionState()", "return LucentLocation.permissionState()"],
  setPermission: ["LucentLocation.setPermission(state)", "LucentLocation.setPermission(state)"],
} as const;

const ownedCreates = new Set(["LocationProvider__create"]);

const bindings: Record<string, NativeBinding> = Object.fromEntries(
  Object.entries(operations).map(([name, [swift, kotlin]]) => [
    name,
    {
      contract: {
        symbolId: symbol(name.split("__")[0]!, name, "v1"),
        ...(ownedCreates.has(name) ? { result: "owned" as const } : {}),
        ...(name === "LocationProvider__method_updates" ? { parameters: { callback: updatesCallbackContract } } : {}),
        ...(name === "LocationProvider__method_close" ? { cancellation: "cooperative" as const } : {}),
      },
      ...(name === "LocationProvider__method_updates" ||
      name === "LocationProvider__method_deliverFake" ||
      name.startsWith("Position__")
        ? { nativeOnly: true }
        : {}),
      swift: [swift],
      kotlin: [kotlin],
    },
  ]),
);

/** Location acceptance package — fake positions for CI. */
export const LOCATION_LIBRARY: LibraryModule = {
  schemaVersion: 1,
  source: `import type {NativeCallback} from '@lucent-lang/core/types';
export type LocationPermission = "unknown" | "granted" | "denied" | "restricted";
export type Position = { latitude: number; longitude: number; accuracy: number; timestamp: number };
export type LocationProvider = { closed: boolean };
export declare function LocationProvider__create(): LocationProvider;
export declare function LocationProvider__get_closed(lucentSelf: LocationProvider): boolean;
export declare function LocationProvider__method_updates(lucentSelf: LocationProvider, callback: NativeCallback<(position: Position) => number>): number;
export declare function LocationProvider__method_deliverFake(lucentSelf: LocationProvider, latitude: number, longitude: number, accuracy: number, timestamp: number): number;
export declare function LocationProvider__method_staleDrops(lucentSelf: LocationProvider): number;
export declare function LocationProvider__method_duplicateDrops(lucentSelf: LocationProvider): number;
export declare function LocationProvider__method_close(lucentSelf: LocationProvider): Promise<void>;
export declare function Position__get_latitude(lucentSelf: Position): number;
export declare function Position__get_longitude(lucentSelf: Position): number;
export declare function Position__get_accuracy(lucentSelf: Position): number;
export declare function Position__get_timestamp(lucentSelf: Position): number;
export declare function requestPermission(): LocationPermission;
export declare function permissionState(): LocationPermission;
export declare function setPermission(state: LocationPermission): void;`,
  enums: {
    LocationPermission: {
      cases: ["unknown", "granted", "denied", "restricted"],
      swift: {
        type: "String",
        values: {
          unknown: '"unknown"',
          granted: '"granted"',
          denied: '"denied"',
          restricted: '"restricted"',
        },
      },
      kotlin: {
        type: "String",
        values: {
          unknown: '"unknown"',
          granted: '"granted"',
          denied: '"denied"',
          restricted: '"restricted"',
        },
      },
    },
  },
  references: {
    Position: {
      nativeOnly: true,
      swift: "LucentPosition",
      kotlin: "LucentPosition",
      /** Borrowed for the updates callback only; copy fields out before return. */
      contract: { ownership: "external", executor: "caller" },
    },
    LocationProvider: {
      nativeOnly: true,
      swift: "LucentLocationProvider",
      kotlin: "LucentLocationProvider",
      contract: { ownership: "owned", executor: "caller", transferable: true, close: "close" },
    },
  },
  bindings,
  native: {
    capabilities: ["location"],
    swift: { "Location.swift": nativeSource("Location.swift") },
    kotlin: { "Location.kt": nativeSource("Location.kt") },
  },
};
