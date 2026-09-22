import { expect, test } from "vite-plus/test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { validateOverlay } from "../src/overlay.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const bluetoothOverlay = JSON.parse(
  readFileSync(join(root, "packages/bluetooth/lucent-overlay.json"), "utf8"),
) as unknown;

test("loads bluetooth package overlay and accepts a valid shape", () => {
  expect(validateOverlay(bluetoothOverlay)).toEqual([]);
  expect((bluetoothOverlay as { package: string }).package).toBe("@lucent-lang/bluetooth");
});

test("rejects retention mismatch: call with backpressure", () => {
  const bad = {
    schemaVersion: 1,
    package: "@lucent-lang/sqlite",
    callbacks: {
      "SQLiteDatabase.transaction": {
        retention: "call",
        executor: "caller",
        errors: "propagate",
        backpressure: "block",
      },
    },
  };
  const errors = validateOverlay(bad);
  expect(errors.some((e) => e.includes("Retention mismatch") && e.includes("backpressure"))).toBe(true);
});

test("rejects retention mismatch: call with remove", () => {
  const bad = {
    schemaVersion: 1,
    package: "@example/pkg",
    callbacks: {
      "Host.onEvent": {
        retention: "call",
        executor: "caller",
        errors: "propagate",
        remove: "offEvent",
      },
    },
  };
  expect(validateOverlay(bad).some((e) => e.includes("remove"))).toBe(true);
});
