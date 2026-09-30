import { describe, expect, it } from "vite-plus/test";
import { checksSummary, summaryLine } from "./summary";

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
