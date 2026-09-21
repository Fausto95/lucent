import { expect, test } from "vite-plus/test";
import { compile } from "@lucent-lang/compiler";
import { generateKotlin } from "../src/index.ts";
test("emits native binding bodies and dispatcher hops", () => {
  const result = compile(
    'import { now } from "@lucent-lang/platform/clock"; @MainThread export async function f(): Promise<number> { return now(); }',
    { fileName: "clock.lucent.ts" },
  );
  const code = generateKotlin(result.module!).code;
  expect(code).toContain("System.currentTimeMillis()");
  expect(code).toContain("withContext(kotlinx.coroutines.Dispatchers.Main)");
  expect(code).toContain("return@withContext");
});
