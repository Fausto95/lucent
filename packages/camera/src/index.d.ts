import type { NativeCallback } from "@lucent-lang/core/types";
import type { NativeView } from "@lucent-lang/core/ui";

/** Permission state for camera access (authoring surface). */
export type CameraPermission = "unknown" | "granted" | "denied" | "restricted";

/** Session interruption reason (CI stub; device mapping is host work). */
export type SessionInterruption = "none" | "audio" | "system" | "background";

/**
 * Borrowed camera frame buffer. Valid only for the duration of a frames
 * callback; do not retain or return it.
 */
export declare class Frame {
  readonly width: number;
  readonly height: number;
  readonly rowStride: number;
  readonly pixelStride: number;
}

/** Free helpers for borrowed frames (same contract as property getters). */
export declare function width(frame: Frame): number;
export declare function height(frame: Frame): number;
export declare function rowStride(frame: Frame): number;
export declare function pixelStride(frame: Frame): number;
export declare function sample(frame: Frame, index: number): number;

/**
 * Owned camera session. Prefer a component `resource(() => new CameraSession())`
 * slot so the host closes on unmount; otherwise call `await session.close()`.
 */
export declare class CameraSession {
  constructor();
  readonly closed: boolean;
  readonly interrupted: boolean;
  readonly interruptionReason: SessionInterruption;
  start(): void;
  stop(): void;
  /** Stub interruption; deliveries while interrupted increment drop counter. */
  interrupt(reason: SessionInterruption): void;
  /** Clear interruption and resume running. */
  restart(): void;
  /**
   * Subscribe to frames. Package policy is keep-latest backpressure on a worker
   * executor with notify errors; CI stub increments `droppedFrames` under pressure.
   */
  frames(callback: NativeCallback<(frame: Frame) => number>): number;
  /** CI-only: push one synthetic borrowed frame into the retained callback. */
  deliverSynthetic(bytes: number[], width: number, height: number, rowStride: number, pixelStride: number): number;
  /** Frames dropped under keep-latest / interruption since last reset. */
  droppedFrames(): number;
  resetDropCounter(): void;
  close(): Promise<void>;
  dispose(): void;
}

export declare function requestPermission(): CameraPermission;
export declare function permissionState(): CameraPermission;
/** CI-only: set stub permission union state. */
export declare function setPermission(state: CameraPermission): void;

/**
 * Preview view binding stub for hosts that support package NativeViews.
 * No physical camera; renders a placeholder label.
 */
export declare function CameraPreview(props: { mirrored?: boolean }): NativeView;
