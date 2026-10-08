import { describe, expect, it } from "vite-plus/test";
import { checksSummary, progressLine, summaryLine } from "./summary";

describe("checksSummary", () => {
  it("says ALL PASSED when every check passes", () => {
    const summary = checksSummary("tests", [
      { name: "basics", pass: true },
      { name: "strings", pass: true },
    ]);

    expect(summary).toEqual({
      ok: true,
      text: "ALL PASSED",
      line: "LUCENT_SUMMARY tests 2/2 passed",
    });
  });

  it("counts the failures and names them in the log line", () => {
    const summary = checksSummary("sdk", [
      { name: "clipboard: set, get, has", pass: true },
      { name: "location: current position", pass: false },
      { name: "netinfo: fetch", pass: false },
    ]);

    expect(summary).toEqual({
      ok: false,
      text: "2 FAILED",
      line: "LUCENT_SUMMARY sdk 1/3 passed; failed: location: current position | netinfo: fetch",
    });
  });
});

describe("summaryLine", () => {
  it("prefixes a screen's result so logs can be searched for it", () => {
    expect(summaryLine("bench", "6.3x faster (geometric mean)")).toBe(
      "LUCENT_SUMMARY bench 6.3x faster (geometric mean)",
    );
  });

  it("keeps the line on one line", () => {
    expect(summaryLine("compare", "numbers 1.2x\nstrings 0.9x")).toBe(
      "LUCENT_SUMMARY compare numbers 1.2x strings 0.9x",
    );
  });
});

describe("progressLine", () => {
  it("marks the start of a run", () => {
    expect(progressLine("tests", 0, 70)).toBe("LUCENT_PROGRESS tests 0/70 started");
  });

  it("names each check as it lands, with its time when it has one", () => {
    expect(progressLine("tests", 5, 70, { name: "closures", pass: true, ms: 12 })).toBe(
      "LUCENT_PROGRESS tests 5/70 closures ok 12ms",
    );
    expect(progressLine("sdk", 2, 3, { name: "netinfo: fetch", pass: false })).toBe(
      "LUCENT_PROGRESS sdk 2/3 netinfo: fetch FAILED",
    );
  });
});
