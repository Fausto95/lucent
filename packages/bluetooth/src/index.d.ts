import type { NativeCallback } from "@lucent-lang/core/types";

export type ConnectionState = "connecting" | "connected" | "disconnecting" | "disconnected";

/**
 * Owned BLE scanner. Close on teardown; feature orchestration (scan → select →
 * connect) belongs in Lucent.
 */
export declare class BluetoothScanner {
  constructor();
  readonly closed: boolean;
  start(): void;
  stop(): void;
  /** CI-only: enqueue a discovered peripheral while scanning. */
  enqueueScanResult(peripheralId: string): void;
  /** Pop the oldest scan result, or `""` when empty. */
  pollScanResult(): string;
  /** Connect to a CI fake peripheral id (e.g. `"fake-1"`). */
  connect(peripheralId: string): Promise<BluetoothConnection>;
  close(): Promise<void>;
  dispose(): void;
}

/**
 * Owned BLE connection. Binary payloads are `Uint8Array`. Notifications use
 * package policy buffer(n=32) with compiler contract `backpressure: "block"`;
 * overflow throws `BUFFER_OVERFLOW`.
 */
export declare class BluetoothConnection {
  readonly closed: boolean;
  readonly connectionState: ConnectionState;
  read(characteristic: string): Promise<Uint8Array>;
  /** CI-only borrowed characteristic view; must not escape. */
  borrowRead(characteristic: string): Promise<Uint8Array>;
  write(characteristic: string, payload: Uint8Array): Promise<void>;
  notifications(characteristic: string, callback: NativeCallback<(payload: Uint8Array) => number>): number;
  /** CI-only: push one notification into the retained callback. */
  deliverNotification(characteristic: string, payload: Uint8Array): number;
  close(): Promise<void>;
  dispose(): void;
}
