import type { LibraryModule, NativeBinding } from "@lucent-lang/compiler";
import { nativeSymbolId } from "@lucent-lang/compiler";
import { nativeSource } from "./native-sources.generated.ts";

const symbol = (owner: string, name: string, abi: string) => nativeSymbolId("Streaming", owner, name, abi);

/**
 * Chunk delivery returns owned buffers. Prefetch capacity is package metadata
 * (`CHUNK_SOURCE_CAPACITY`); the CI stub respects the bound when enqueueing.
 */
export const CHUNK_SOURCE_CAPACITY = 4;

const operations = {
  FileChunkSource__create: [
    "return try LucentFileChunkSource.open(path: path, chunkSize: chunkSize, capacity: capacity)",
    "return LucentFileChunkSource.open(path, chunkSize, capacity)",
  ],
  FileChunkSource__get_closed: ["return lucentSelf.closed", "return lucentSelf.closed"],
  FileChunkSource__get_capacity: ["return lucentSelf.capacity", "return lucentSelf.capacity"],
  FileChunkSource__method_readChunk: ["return try await lucentSelf.readChunk()", "return lucentSelf.readChunk()"],
  /** CI-only borrowed chunk view; must not escape the call. */
  FileChunkSource__method_borrowChunk: ["return try await lucentSelf.readChunk()", "return lucentSelf.readChunk()"],
  FileChunkSource__method_enqueueTransform: [
    "return try lucentSelf.enqueueTransform()",
    "return lucentSelf.enqueueTransform()",
  ],
  FileChunkSource__method_cancel: ["lucentSelf.cancel()", "lucentSelf.cancel()"],
  FileChunkSource__method_close: ["await lucentSelf.close()", "lucentSelf.close()"],
  FileWriteSink__create: ["return try LucentFileWriteSink.open(path: path)", "return LucentFileWriteSink.open(path)"],
  FileWriteSink__get_closed: ["return lucentSelf.closed", "return lucentSelf.closed"],
  FileWriteSink__method_write: ["try await lucentSelf.write(chunk: chunk)", "lucentSelf.write(chunk)"],
  FileWriteSink__method_flush: ["try await lucentSelf.flush()", "lucentSelf.flush()"],
  FileWriteSink__method_close: ["await lucentSelf.close()", "lucentSelf.close()"],
  transformChunk: ["return try LucentStreaming.transform(chunk: chunk)", "return LucentStreaming.transform(chunk)"],
  liveBuffers: ["return LucentStreaming.liveBuffers()", "return LucentStreaming.liveBuffers()"],
} as const;

const ownedCreates = new Set([
  "FileChunkSource__create",
  "FileWriteSink__create",
  "FileChunkSource__method_readChunk",
  "transformChunk",
]);
const borrowedResults = new Set(["FileChunkSource__method_borrowChunk"]);

const bindings: Record<string, NativeBinding> = Object.fromEntries(
  Object.entries(operations).map(([name, [swift, kotlin]]) => [
    name,
    {
      contract: {
        symbolId: symbol(name.split("__")[0]!, name, "v1"),
        ...(ownedCreates.has(name) ? { result: "owned" as const } : {}),
        ...(borrowedResults.has(name) ? { result: "borrowed" as const } : {}),
        ...(name === "FileWriteSink__method_write"
          ? { parameters: { chunk: { ownership: "borrowed" as const } } }
          : {}),
        ...(name === "transformChunk" ? { parameters: { chunk: { ownership: "borrowed" as const } } } : {}),
        ...(name.endsWith("__method_close") ? { cancellation: "cooperative" as const } : {}),
      },
      ...(name === "FileChunkSource__method_borrowChunk" || name === "FileChunkSource__method_enqueueTransform"
        ? { nativeOnly: true }
        : {}),
      swift: [swift],
      kotlin: [kotlin],
    },
  ]),
);

/** Streaming acceptance package — owned chunks, write sinks, explicit contracts. */
export const STREAMING_LIBRARY: LibraryModule = {
  schemaVersion: 1,
  source: `export type FileChunkSource = { closed: boolean; capacity: number };
export type FileWriteSink = { closed: boolean };
export declare function FileChunkSource__create(path: string, chunkSize: number, capacity: number): FileChunkSource;
export declare function FileChunkSource__get_closed(lucentSelf: FileChunkSource): boolean;
export declare function FileChunkSource__get_capacity(lucentSelf: FileChunkSource): number;
export declare function FileChunkSource__method_readChunk(lucentSelf: FileChunkSource): Promise<Uint8Array>;
export declare function FileChunkSource__method_borrowChunk(lucentSelf: FileChunkSource): Promise<Uint8Array>;
export declare function FileChunkSource__method_enqueueTransform(lucentSelf: FileChunkSource): number;
export declare function FileChunkSource__method_cancel(lucentSelf: FileChunkSource): void;
export declare function FileChunkSource__method_close(lucentSelf: FileChunkSource): Promise<void>;
export declare function FileWriteSink__create(path: string): FileWriteSink;
export declare function FileWriteSink__get_closed(lucentSelf: FileWriteSink): boolean;
export declare function FileWriteSink__method_write(lucentSelf: FileWriteSink, chunk: Uint8Array): Promise<void>;
export declare function FileWriteSink__method_flush(lucentSelf: FileWriteSink): Promise<void>;
export declare function FileWriteSink__method_close(lucentSelf: FileWriteSink): Promise<void>;
export declare function transformChunk(chunk: Uint8Array): Uint8Array;
export declare function liveBuffers(): number;`,
  references: {
    FileChunkSource: {
      nativeOnly: true,
      swift: "LucentFileChunkSource",
      kotlin: "LucentFileChunkSource",
      contract: { ownership: "owned", executor: "caller", transferable: true, close: "close" },
    },
    FileWriteSink: {
      nativeOnly: true,
      swift: "LucentFileWriteSink",
      kotlin: "LucentFileWriteSink",
      contract: { ownership: "owned", executor: "caller", transferable: true, close: "close" },
    },
  },
  bindings,
  native: {
    capabilities: ["streaming"],
    swift: { "Streaming.swift": nativeSource("Streaming.swift") },
    kotlin: { "Streaming.kt": nativeSource("Streaming.kt") },
  },
};
