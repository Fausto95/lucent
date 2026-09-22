import { NativeResource } from "@lucent-lang/core/resources";
import { FileChunkSource, FileWriteSink, transformChunk } from "@lucent-lang/streaming";

/** Read owned chunks, transform, write (borrowed for await), flush, close. */
export async function runPipeline(): Promise<void> {
  const slot = new NativeResource();
  const source = new FileChunkSource("input.bin", 64, 4);
  const sink = new FileWriteSink("output.bin");
  const chunk = await source.readChunk();
  const output = transformChunk(chunk);
  await sink.write(output);
  await sink.flush();
  await source.close();
  await sink.close();
  await slot.close();
}
