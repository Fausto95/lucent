import { describe, expect, it } from "vite-plus/test";
import { lastVerdict, pickSimulator } from "./device-check.ts";

describe("lastVerdict", () => {
  it("reads the Tests screen's line from a device log", () => {
    const log = [
      "10-08 12:00:01.000 I Lucent: something else",
      "10-08 12:00:09.000 I Lucent: LUCENT_SUMMARY tests 23/23 passed",
    ].join("\n");
    expect(lastVerdict(log)).toEqual({
      passed: 23,
      total: 23,
      ok: true,
      line: "LUCENT_SUMMARY tests 23/23 passed",
    });
  });

  it("fails a run with a failed case, and keeps the names", () => {
    const v = lastVerdict("LUCENT_SUMMARY tests 22/23 passed; failed: closures\n");
    expect(v).toMatchObject({ passed: 22, total: 23, ok: false });
    expect(v?.line).toBe("LUCENT_SUMMARY tests 22/23 passed; failed: closures");
  });

  it("takes the last run when the screen ran twice", () => {
    const log = "LUCENT_SUMMARY tests 1/2 passed\nLUCENT_SUMMARY tests 2/2 passed\n";
    expect(lastVerdict(log)?.ok).toBe(true);
  });

  it("ignores the other screens and an empty run", () => {
    expect(lastVerdict("LUCENT_SUMMARY sdk 3/3 passed")).toBeUndefined();
    expect(lastVerdict("LUCENT_SUMMARY tests 0/0 passed")?.ok).toBe(false);
  });
});

describe("pickSimulator", () => {
  const phone = (name: string, udid: string, isAvailable = true) => ({
    name,
    udid,
    state: "Shutdown",
    isAvailable,
  });

  it("takes an available iPhone on the newest iOS runtime", () => {
    const list = {
      devices: {
        "com.apple.CoreSimulator.SimRuntime.iOS-26-4": [phone("iPhone 17", "a")],
        "com.apple.CoreSimulator.SimRuntime.iOS-26-5": [
          phone("iPad Air 11-inch (M4)", "b"),
          phone("iPhone 17 Pro", "c", false),
          phone("iPhone 17", "d"),
        ],
        "com.apple.CoreSimulator.SimRuntime.tvOS-26-5": [phone("Apple TV", "e")],
      },
    };
    expect(pickSimulator(list)?.udid).toBe("d");
  });

  it("finds none without an iPhone", () => {
    expect(pickSimulator({ devices: {} })).toBeUndefined();
  });
});
