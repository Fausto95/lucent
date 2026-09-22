import { describe, expect, test } from "vite-plus/test";
import { createDebouncer, isWatchedPath } from "../src/watch.ts";

describe("isWatchedPath", () => {
  test.each([
    ["src/geo.lucent.ts", true],
    ["src/screen.lucent.tsx", true],
    ["lucent.config.ts", true],
    ["lucent.config.json", true],
    ["native/text.library.json", true],
    ["src/app.ts", false],
    ["node_modules/dep/x.lucent.ts", false],
    [".lucent/ir/geo.ir.txt", false],
    ["modules/lucent/ios/Geo.swift", false],
    ["ios/Pods/x.lucent.ts", false],
  ])("%s → %s", (path, expected) => {
    expect(isWatchedPath(path)).toBe(expected);
  });
});

test("debouncer coalesces bursts into one call", async () => {
  let calls = 0;
  const trigger = createDebouncer(() => calls++, 15);
  trigger();
  trigger();
  trigger();
  expect(calls).toBe(0);
  await new Promise((r) => setTimeout(r, 40));
  expect(calls).toBe(1);
});
