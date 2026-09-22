import type { Counter } from "./counter.lucent";
import { event } from "@lucent-lang/events";
import { abs, sqrt } from "@lucent-lang/core/math";
import { Platform } from "@lucent-lang/platform";
import { copyBytes, decodeUTF8, encodeUTF8 } from "@lucent-lang/core";
import { deviceModel, readFile, sha256, temporaryDirectory, writeFile } from "@lucent-lang/example-toolkit";
export type Result = { kind: "ok"; value: number } | { kind: "error"; message: string };
export const progress = event<number>();
export function report(value: number): void {
  progress.emit(value);
}
export function advance(counter: Counter): number {
  return counter.increment(1);
}
export function evaluate(value: number): Result {
  if (value < 0) {
    return { kind: "error", message: "Negative" };
  }
  return { kind: "ok", value: sqrt(abs(value)) };
}
// @ts-expect-error Lucent function decorator; compiled before TypeScript.
@Background
export async function double(value: number): Promise<number> {
  return value * 2;
}
export function nativeOS(): string {
  return Platform.OS;
}
export function bytes(text: string): Uint8Array {
  return copyBytes(encodeUTF8(text));
}
export function hash(text: string): string {
  return sha256(encodeUTF8(text));
}
export async function fileRoundTrip(text: string): Promise<string> {
  const directory = await temporaryDirectory();
  const path = directory + "/lucent-runtime-check.txt";
  await writeFile(path, encodeUTF8(text));
  return decodeUTF8(await readFile(path));
}
export async function model(): Promise<string> {
  return await deviceModel();
}
export function metadataFailure(path: string): void {
  throw new LucentError("MISSING", {
    message: "File\n不存在 🌍",
    metadata: { path, attempt: 1, retry: false, detail: null },
  });
}
