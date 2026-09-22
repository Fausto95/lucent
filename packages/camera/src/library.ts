import type { LibraryModule, NativeBinding } from "@lucent-lang/compiler";
import { nativeSymbolId, T } from "@lucent-lang/compiler";
import { nativeSource } from "./native-sources.generated.ts";

const symbol = (owner: string, name: string, abi: string) => nativeSymbolId("Camera", owner, name, abi);

/**
 * Keep-latest is the camera package backpressure policy for `frames`.
 * The callback contract carries `backpressure: "latest"`; the CI native stub
 * delivers synchronously and increments `droppedFrames` under pressure.
 */
const framesCallbackContract = {
  ownership: "retained" as const,
  callback: {
    retention: "subscription" as const,
    executor: "worker" as const,
    errors: "notify" as const,
    backpressure: "latest" as const,
  },
};

const operations = {
  CameraSession__create: ["return LucentCameraSession()", "return LucentCameraSession()"],
  CameraSession__get_closed: ["return lucentSelf.closed", "return lucentSelf.closed"],
  CameraSession__get_interrupted: ["return lucentSelf.interrupted", "return lucentSelf.interrupted"],
  CameraSession__get_interruptionReason: [
    "return lucentSelf.interruptionReasonValue",
    "return lucentSelf.interruptionReasonValue",
  ],
  CameraSession__method_start: ["try lucentSelf.start()", "lucentSelf.start()"],
  CameraSession__method_stop: ["lucentSelf.stop()", "lucentSelf.stop()"],
  CameraSession__method_interrupt: ["try lucentSelf.interrupt(reason: reason)", "lucentSelf.interrupt(reason)"],
  CameraSession__method_restart: ["try lucentSelf.restart()", "lucentSelf.restart()"],
  CameraSession__method_frames: ["return try lucentSelf.frames(callback)", "return lucentSelf.frames(callback)"],
  CameraSession__method_deliverSynthetic: [
    "return try lucentSelf.deliverSynthetic(bytes: bytes.map { UInt8(clamping: Int($0)) }, width: width, height: height, rowStride: rowStride, pixelStride: pixelStride)",
    "return lucentSelf.deliverSynthetic(bytes.map { it.toInt().toByte() }.toByteArray(), width, height, rowStride, pixelStride)",
  ],
  CameraSession__method_droppedFrames: ["return lucentSelf.droppedFrames()", "return lucentSelf.droppedFrames()"],
  CameraSession__method_resetDropCounter: ["lucentSelf.resetDropCounter()", "lucentSelf.resetDropCounter()"],
  CameraSession__method_close: ["await lucentSelf.close()", "lucentSelf.close()"],
  Frame__get_width: ["return lucentSelf.width", "return lucentSelf.width"],
  Frame__get_height: ["return lucentSelf.height", "return lucentSelf.height"],
  Frame__get_rowStride: ["return lucentSelf.rowStride", "return lucentSelf.rowStride"],
  Frame__get_pixelStride: ["return lucentSelf.pixelStride", "return lucentSelf.pixelStride"],
  width: ["return frame.width", "return frame.width"],
  height: ["return frame.height", "return frame.height"],
  rowStride: ["return frame.rowStride", "return frame.rowStride"],
  pixelStride: ["return frame.pixelStride", "return frame.pixelStride"],
  sample: ["return try frame.sample(index)", "return frame.sample(index)"],
  requestPermission: ["return LucentCamera.requestPermission()", "return LucentCamera.requestPermission()"],
  permissionState: ["return LucentCamera.permissionState()", "return LucentCamera.permissionState()"],
  setPermission: ["LucentCamera.setPermission(state)", "LucentCamera.setPermission(state)"],
} as const;

const ownedCreates = new Set(["CameraSession__create"]);

const bindings: Record<string, NativeBinding> = Object.fromEntries(
  Object.entries(operations).map(([name, [swift, kotlin]]) => [
    name,
    {
      contract: {
        symbolId: symbol(name.split("__")[0]!, name, "v1"),
        ...(ownedCreates.has(name) ? { result: "owned" as const } : {}),
        ...(name === "CameraSession__method_frames" ? { parameters: { callback: framesCallbackContract } } : {}),
      },
      ...(name === "CameraSession__method_frames" ||
      name === "width" ||
      name === "height" ||
      name === "rowStride" ||
      name === "pixelStride" ||
      name === "sample"
        ? { nativeOnly: true }
        : {}),
      swift: [swift],
      kotlin: [kotlin],
    },
  ]),
);

/** Camera acceptance package library — FakeSdk-style CI stubs; physical camera optional. */
export const CAMERA_LIBRARY: LibraryModule = {
  schemaVersion: 1,
  source: `import type {NativeCallback} from '@lucent-lang/core/types';
export type CameraPermission = "unknown" | "granted" | "denied" | "restricted";
export type SessionInterruption = "none" | "audio" | "system" | "background";
export type Frame = { width: number; height: number; rowStride: number; pixelStride: number };
export type CameraSession = { closed: boolean; interrupted: boolean };
export declare function CameraSession__create(): CameraSession;
export declare function CameraSession__get_closed(lucentSelf: CameraSession): boolean;
export declare function CameraSession__get_interrupted(lucentSelf: CameraSession): boolean;
export declare function CameraSession__get_interruptionReason(lucentSelf: CameraSession): SessionInterruption;
export declare function CameraSession__method_start(lucentSelf: CameraSession): void;
export declare function CameraSession__method_stop(lucentSelf: CameraSession): void;
export declare function CameraSession__method_interrupt(lucentSelf: CameraSession, reason: SessionInterruption): void;
export declare function CameraSession__method_restart(lucentSelf: CameraSession): void;
export declare function CameraSession__method_frames(lucentSelf: CameraSession, callback: NativeCallback<(frame: Frame) => number>): number;
export declare function CameraSession__method_deliverSynthetic(lucentSelf: CameraSession, bytes: number[], width: number, height: number, rowStride: number, pixelStride: number): number;
export declare function CameraSession__method_droppedFrames(lucentSelf: CameraSession): number;
export declare function CameraSession__method_resetDropCounter(lucentSelf: CameraSession): void;
export declare function CameraSession__method_close(lucentSelf: CameraSession): Promise<void>;
export declare function Frame__get_width(lucentSelf: Frame): number;
export declare function Frame__get_height(lucentSelf: Frame): number;
export declare function Frame__get_rowStride(lucentSelf: Frame): number;
export declare function Frame__get_pixelStride(lucentSelf: Frame): number;
export declare function width(frame: Frame): number;
export declare function height(frame: Frame): number;
export declare function rowStride(frame: Frame): number;
export declare function pixelStride(frame: Frame): number;
export declare function sample(frame: Frame, index: number): number;
export declare function requestPermission(): CameraPermission;
export declare function permissionState(): CameraPermission;
export declare function setPermission(state: CameraPermission): void;`,
  enums: {
    CameraPermission: {
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
    SessionInterruption: {
      cases: ["none", "audio", "system", "background"],
      swift: {
        type: "String",
        values: {
          none: '"none"',
          audio: '"audio"',
          system: '"system"',
          background: '"background"',
        },
      },
      kotlin: {
        type: "String",
        values: {
          none: '"none"',
          audio: '"audio"',
          system: '"system"',
          background: '"background"',
        },
      },
    },
  },
  references: {
    Frame: {
      nativeOnly: true,
      swift: "LucentCameraFrame",
      kotlin: "LucentCameraFrame",
      contract: { ownership: "external", executor: "caller" },
    },
    CameraSession: {
      nativeOnly: true,
      swift: "LucentCameraSession",
      kotlin: "LucentCameraSession",
      contract: { ownership: "owned", executor: "caller", transferable: true, close: "close" },
    },
  },
  views: {
    CameraPreview: {
      props: { mirrored: T.bool },
      children: "none",
      swift: {
        template: 'Text({{prop:mirrored}} ? "camera-preview-mirrored" : "camera-preview")',
        defaults: { mirrored: "false" },
        imports: ["SwiftUI"],
      },
      kotlin: {
        template: 'Text(text = if ({{prop:mirrored}}) "camera-preview-mirrored" else "camera-preview")',
        defaults: { mirrored: "false" },
        imports: ["androidx.compose.material3.Text"],
      },
    },
  },
  bindings,
  native: {
    capabilities: ["camera"],
    swift: { "Camera.swift": nativeSource("Camera.swift") },
    kotlin: { "Camera.kt": nativeSource("Camera.kt") },
  },
};
