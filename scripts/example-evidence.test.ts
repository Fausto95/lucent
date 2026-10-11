import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vite-plus/test";
import { evidenceBlock, readEvidence, sentence, withEvidence } from "./example-evidence.ts";

function records(json: unknown): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lucent-evidence-"));
  fs.writeFileSync(path.join(dir, "evidence.json"), JSON.stringify(json));
  return dir;
}

describe("example evidence", () => {
  it("says what each level claims and what it leaves unproven", () => {
    expect(sentence({ level: "host", how: "in CI's unit tests" })).toBe(
      "Compiled for the host, without either SDK, in CI's unit tests. Not yet typed against the SDKs, or run on a simulator, an emulator or a device.",
    );
    expect(sentence({ level: "sim", date: "2026-09-25", how: "in the Lab" })).toBe(
      "Run on the iOS simulator and the Android emulator in the Lab (2026-09-25). Not yet run on a physical device.",
    );
    expect(sentence({ level: "sim", platforms: ["android"], how: "in the Lab" })).toBe(
      "Run on the Android emulator in the Lab. Not yet run on a physical device.",
    );
    expect(
      sentence({ level: "device", date: "2026-11-01", platforms: ["ios"], how: "in the Lab" }),
    ).toBe("Run on physical iPhones in the Lab (2026-11-01).");
    expect(sentence({ subject: "Rating", level: "code", how: "on Linux" })).toBe(
      "`Rating`: written on Linux. Not yet compiled against either SDK, or run.",
    );
  });

  it("states one record as a line, several as a list", () => {
    const one = evidenceBlock([{ level: "code", how: "on Linux" }]);
    expect(one).toContain("**Evidence:** Written on Linux.");
    const two = evidenceBlock([
      { subject: "A", level: "code", how: "on Linux" },
      { subject: "B", level: "host", how: "in CI" },
    ]);
    expect(two).toContain("**Evidence:**\n\n- `A`: written on Linux.");
    expect(two).toContain("\n- `B`: compiled for the host");
  });

  it("replaces a README's block, or adds one at its end", () => {
    const first = evidenceBlock([{ level: "code", how: "on Linux" }]);
    const second = evidenceBlock([{ level: "host", how: "in CI" }]);
    const added = withEvidence("# x\n\nText.\n", first);
    expect(added).toBe(`# x\n\nText.\n\n${first}\n`);
    expect(withEvidence(added, second)).toBe(`# x\n\nText.\n\n${second}\n`);
  });

  it("refuses records that claim what they can't", () => {
    expect(() => readEvidence(records([]))).toThrow(/non-empty array/);
    expect(() => readEvidence(records([{ level: "tested", how: "x" }]))).toThrow(/level/);
    expect(() => readEvidence(records([{ level: "device", how: "x" }]))).toThrow(/needs its date/);
    expect(() => readEvidence(records([{ level: "host", platforms: ["ios"], how: "x" }]))).toThrow(
      /simulator or device run/,
    );
    expect(() => readEvidence(records([{ level: "sim", date: "25/09", how: "x" }]))).toThrow(
      /YYYY-MM-DD/,
    );
    expect(() => readEvidence(records([{ level: "sim", how: "x", ranOn: "a phone" }]))).toThrow(
      /unknown field/,
    );
  });
});
