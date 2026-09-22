import { expect, test } from "vite-plus/test";
import { compile } from "../src/index.ts";
test("supports an explicitly transferable native cancellation source", () => {
  const result = compile(
    'import {CancellationSource} from "@lucent-lang/core/cancellation"; export function create():CancellationSource{return new CancellationSource();} export async function work(source:CancellationSource):Promise<boolean>{source.throwIfCancelled();return source.cancelled;}',
    { fileName: "cancellation.lucent.ts" },
  );
  expect(result.diagnostics).toEqual([]);
  expect(result.module?.structs.some((s) => s.reference?.native?.contract?.transferable)).toBe(true);
  expect(
    Object.values(result.module?.nativePackages ?? {}).some(
      (p) => p.swift?.["Cancellation.swift"] && p.kotlin?.["Cancellation.kt"],
    ),
  ).toBe(true);
});
