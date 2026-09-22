import { expect, test } from "vite-plus/test";
import { compile, validateLibrary } from "@lucent-lang/compiler";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { STREAMING_LIBRARY, CHUNK_SOURCE_CAPACITY } from "../src/library.ts";

const libraries = { "@lucent-lang/streaming": STREAMING_LIBRARY };
const here = dirname(fileURLToPath(import.meta.url));
const lucent = (name: string) => readFileSync(join(here, "..", "lucent", name), "utf8");

test("STREAMING_LIBRARY passes validation with owned chunks and borrowed write", () => {
  expect(validateLibrary(STREAMING_LIBRARY)).toEqual([]);
  expect(CHUNK_SOURCE_CAPACITY).toBe(4);
  expect(STREAMING_LIBRARY.bindings!.FileChunkSource__method_readChunk!.contract!.result).toBe("owned");
  expect(STREAMING_LIBRARY.bindings!.FileWriteSink__method_write!.contract!.parameters!.chunk).toEqual({
    ownership: "borrowed",
  });
  expect(STREAMING_LIBRARY.bindings!.transformChunk!.contract!.parameters!.chunk).toEqual({
    ownership: "borrowed",
  });
  expect(STREAMING_LIBRARY.bindings!.transformChunk!.contract!.result).toBe("owned");
});

test("compiles chunk → transform → write pipeline", () => {
  const result = compile(lucent("pipeline.lucent.ts"), {
    fileName: "pipeline.lucent.ts",
    libraries,
  });
  expect(result.diagnostics).toEqual([]);
  expect(result.module).not.toBeNull();
  expect(Object.values(result.module!.nativePackages ?? {}).flatMap((p) => Object.keys(p.swift ?? {}))).toEqual(
    expect.arrayContaining(["Streaming.swift", "Resource.swift"]),
  );
});

test("rejects borrowed chunk escape", () => {
  const result = compile(
    `import {FileChunkSource} from '@lucent-lang/streaming';
export async function leak(source:FileChunkSource):Promise<Uint8Array>{
  return await source.borrowChunk();
}`,
    { fileName: "chunk-escape.lucent.ts", libraries },
  );
  expect(result.module).toBeNull();
  expect(result.diagnostics.length).toBeGreaterThan(0);
});

test("rejects use after close", () => {
  const result = compile(
    `import {FileChunkSource} from '@lucent-lang/streaming';
export async function bad(source:FileChunkSource):Promise<Uint8Array>{
  await source.close();
  return await source.readChunk();
}`,
    { fileName: "use-after-close.lucent.ts", libraries },
  );
  expect(result.module).toBeNull();
  expect(result.diagnostics.some((d) => d.message.includes("closed"))).toBe(true);
});
