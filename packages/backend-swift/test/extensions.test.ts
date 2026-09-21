import { expect, test } from "vite-plus/test";
import { compile } from "@lucent-lang/compiler";
import { generateSwift } from "../src/index.ts";
test("emits native binding bodies and actor isolation", () => {
  const result = compile(
    'import { now } from "@lucent-lang/platform/clock"; @MainThread export async function f(): Promise<number> { return now(); }',
    { fileName: "clock.lucent.ts" },
  );
  const code = generateSwift(result.module!).code;
  expect(code).toContain("Date().timeIntervalSince1970");
  expect(code).toContain("@MainActor");
});
