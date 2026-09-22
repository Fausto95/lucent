import { expect, test } from "vite-plus/test";
import { compile, validateLibrary } from "@lucent-lang/compiler";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { BACKGROUND_LIBRARY } from "../src/library.ts";

const libraries = { "@lucent-lang/background": BACKGROUND_LIBRARY };
const here = dirname(fileURLToPath(import.meta.url));
const lucent = (name: string) => readFileSync(join(here, "..", "lucent", name), "utf8");

test("BACKGROUND_LIBRARY passes validation with transferable closeable handle", () => {
  expect(validateLibrary(BACKGROUND_LIBRARY)).toEqual([]);
  expect(BACKGROUND_LIBRARY.references!.BackgroundJobHandle!.contract).toEqual({
    ownership: "owned",
    executor: "caller",
    transferable: true,
    close: "close",
  });
});

test("compiles durable and in-process schedule orchestration", () => {
  const result = compile(lucent("schedule-job.lucent.ts"), {
    fileName: "schedule-job.lucent.ts",
    libraries,
  });
  expect(result.diagnostics).toEqual([]);
  expect(result.module).not.toBeNull();
  expect(Object.values(result.module!.nativePackages ?? {}).flatMap((p) => Object.keys(p.swift ?? {}))).toEqual(
    expect.arrayContaining(["Background.swift", "Resource.swift"]),
  );
});

test("compiles payloadVersion schedule API", () => {
  const result = compile(
    `import {BackgroundJobHandle,scheduledCount} from '@lucent-lang/background';
export async function schedule():Promise<number>{
  const job=new BackgroundJobHandle("sync-records",1,"{\\"v\\":1}",true);
  const before=scheduledCount();
  await job.close();
  return before;
}`,
    { fileName: "schedule.lucent.ts", libraries },
  );
  expect(result.diagnostics).toEqual([]);
  expect(result.module).not.toBeNull();
});

test("rejects borrowed job id escape", () => {
  const result = compile(
    `import {BackgroundJobHandle} from '@lucent-lang/background';
export function leak(job:BackgroundJobHandle):string{
  return job.borrowJobId();
}`,
    { fileName: "job-id-escape.lucent.ts", libraries },
  );
  expect(result.module).toBeNull();
  expect(result.diagnostics.length).toBeGreaterThan(0);
});

test("rejects use after close", () => {
  const result = compile(
    `import {BackgroundJobHandle} from '@lucent-lang/background';
export async function bad(job:BackgroundJobHandle):Promise<void>{
  await job.close();
  job.cancel();
}`,
    { fileName: "use-after-close.lucent.ts", libraries },
  );
  expect(result.module).toBeNull();
  expect(result.diagnostics.some((d) => d.message.includes("closed"))).toBe(true);
});
