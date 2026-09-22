import type { LibraryModule, NativeBinding } from "@lucent-lang/compiler";
import { nativeSymbolId } from "@lucent-lang/compiler";
import { nativeSource } from "./native-sources.generated.ts";

const symbol = (owner: string, name: string, abi: string) => nativeSymbolId("Background", owner, name, abi);

const operations = {
  BackgroundJobHandle__create: [
    "return LucentBackground.schedule(jobId: jobId, payloadVersion: payloadVersion, payload: payload, durable: durable)",
    "return LucentBackground.schedule(jobId, payloadVersion, payload, durable)",
  ],
  BackgroundJobHandle__get_closed: ["return lucentSelf.closed", "return lucentSelf.closed"],
  BackgroundJobHandle__get_jobId: ["return lucentSelf.jobId", "return lucentSelf.jobId"],
  BackgroundJobHandle__get_payloadVersion: ["return lucentSelf.payloadVersion", "return lucentSelf.payloadVersion"],
  BackgroundJobHandle__get_durable: ["return lucentSelf.durable", "return lucentSelf.durable"],
  /** CI-only borrowed view of the job id; must not escape. */
  BackgroundJobHandle__method_borrowJobId: ["return lucentSelf.jobId", "return lucentSelf.jobId"],
  BackgroundJobHandle__method_cancel: ["lucentSelf.cancel()", "lucentSelf.cancel()"],
  BackgroundJobHandle__method_runOnce: ["return try lucentSelf.runOnce()", "return lucentSelf.runOnce()"],
  BackgroundJobHandle__method_close: ["await lucentSelf.close()", "lucentSelf.close()"],
  scheduledCount: ["return LucentBackground.scheduledCount()", "return LucentBackground.scheduledCount()"],
  runCount: ["return LucentBackground.runCountValue()", "return LucentBackground.runCountValue()"],
} as const;

const ownedCreates = new Set(["BackgroundJobHandle__create"]);
const borrowedResults = new Set(["BackgroundJobHandle__method_borrowJobId"]);

const bindings: Record<string, NativeBinding> = Object.fromEntries(
  Object.entries(operations).map(([name, [swift, kotlin]]) => [
    name,
    {
      contract: {
        symbolId: symbol(name.split("__")[0]!, name, "v1"),
        ...(ownedCreates.has(name) ? { result: "owned" as const } : {}),
        ...(borrowedResults.has(name) ? { result: "borrowed" as const } : {}),
        ...(name === "BackgroundJobHandle__method_close" ? { cancellation: "cooperative" as const } : {}),
      },
      ...(name === "BackgroundJobHandle__method_borrowJobId" ? { nativeOnly: true } : {}),
      swift: [swift],
      kotlin: [kotlin],
    },
  ]),
);

/**
 * Background-tasks acceptance package.
 *
 * Durable OS-scheduled jobs may outlive the JS runtime and require serializable,
 * versioned payloads plus statically registered entry points. In-process jobs are
 * owned by an active resource scope and may hold closures. This scaffold records
 * schedules in a CI stub; OS registration remains host/device work.
 */
export const BACKGROUND_LIBRARY: LibraryModule = {
  schemaVersion: 1,
  source: `export type BackgroundJobHandle = { closed: boolean; jobId: string; payloadVersion: number; durable: boolean };
export declare function BackgroundJobHandle__create(jobId: string, payloadVersion: number, payload: string, durable: boolean): BackgroundJobHandle;
export declare function BackgroundJobHandle__get_closed(lucentSelf: BackgroundJobHandle): boolean;
export declare function BackgroundJobHandle__get_jobId(lucentSelf: BackgroundJobHandle): string;
export declare function BackgroundJobHandle__get_payloadVersion(lucentSelf: BackgroundJobHandle): number;
export declare function BackgroundJobHandle__get_durable(lucentSelf: BackgroundJobHandle): boolean;
export declare function BackgroundJobHandle__method_borrowJobId(lucentSelf: BackgroundJobHandle): string;
export declare function BackgroundJobHandle__method_cancel(lucentSelf: BackgroundJobHandle): void;
export declare function BackgroundJobHandle__method_runOnce(lucentSelf: BackgroundJobHandle): number;
export declare function BackgroundJobHandle__method_close(lucentSelf: BackgroundJobHandle): Promise<void>;
export declare function scheduledCount(): number;
export declare function runCount(): number;`,
  references: {
    BackgroundJobHandle: {
      nativeOnly: true,
      swift: "LucentBackgroundJobHandle",
      kotlin: "LucentBackgroundJobHandle",
      contract: { ownership: "owned", executor: "caller", transferable: true, close: "close" },
    },
  },
  bindings,
  native: {
    capabilities: ["background"],
    swift: { "Background.swift": nativeSource("Background.swift") },
    kotlin: { "Background.kt": nativeSource("Background.kt") },
  },
};
