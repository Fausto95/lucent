import type { NativeCallback } from "@lucent-lang/core/types";

/** Permission state for location access (authoring surface). */
export type LocationPermission = "unknown" | "granted" | "denied" | "restricted";

/**
 * Position value. Borrowed for the duration of an `updates` callback; copy
 * scalar fields out before the callback returns.
 */
export declare class Position {
  readonly latitude: number;
  readonly longitude: number;
  readonly accuracy: number;
  readonly timestamp: number;
}

/**
 * Owned location provider. Updates use keep-latest backpressure
 * (`backpressure: "latest"`). Stale and duplicate deliveries are dropped.
 */
export declare class LocationProvider {
  constructor();
  readonly closed: boolean;
  updates(callback: NativeCallback<(position: Position) => number>): number;
  /** CI-only: deliver one fake position into the retained callback. */
  deliverFake(latitude: number, longitude: number, accuracy: number, timestamp: number): number;
  staleDrops(): number;
  duplicateDrops(): number;
  close(): Promise<void>;
  dispose(): void;
}

export declare function requestPermission(): LocationPermission;
export declare function permissionState(): LocationPermission;
/** CI-only: change permission union state. */
export declare function setPermission(state: LocationPermission): void;
