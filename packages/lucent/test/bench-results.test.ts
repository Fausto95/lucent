import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vite-plus/test";
import {
  benchmarkResult,
  hostManifest,
  readResults,
  summarize,
  writeResults,
} from "../src/cli/bench-results.ts";

describe("benchmark statistics", () => {
  it("takes the median of an odd and an even number of samples", () => {
    expect(summarize([5, 1, 3]).median).toBe(3);
    expect(summarize([4, 1, 3, 2]).median).toBe(2.5);
  });

  it("reports the minimum and maximum, whatever the samples' order", () => {
    const s = summarize([3, 9, 1, 7]);

    expect(s.min).toBe(1);
    expect(s.max).toBe(9);
  });

  it("reports p95 only from 20 samples and p99 only from 100: fewer cannot support them", () => {
    const few = summarize(Array.from({ length: 19 }, (_, i) => i));
    expect(few.p95).toBeUndefined();

    const twenty = summarize(Array.from({ length: 20 }, (_, i) => i + 1));
    expect(twenty.p95).toBe(19);
    expect(twenty.p99).toBeUndefined();

    const hundred = summarize(Array.from({ length: 100 }, (_, i) => i + 1));
    expect(hundred.p95).toBe(95);
    expect(hundred.p99).toBe(99);
  });

  it("rejects an empty sample set", () => {
    expect(() => summarize([])).toThrow(/no samples/);
  });
});

describe("benchmark results", () => {
  it("keeps the raw samples beside their summary", () => {
    const r = benchmarkResult(
      {
        scenario: "kernels/murmur",
        implementation: "lucent",
        manifestId: "m1",
        metric: "throughput",
        unit: "ms/call",
        outputVerified: true,
      },
      [2, 1, 3],
    );

    expect(r.samples).toEqual([2, 1, 3]);
    expect(r).toMatchObject({ median: 2, min: 1, max: 3, outputVerified: true });
  });

  it("describes the machine and toolchain a run used", () => {
    const m = hostManifest({ cxx: "clang++" });

    expect(m.id).toMatch(/^host-/);
    expect(m.host.platform).toBe(process.platform);
    expect(m.host.node).toBe(process.version);
    expect(m.toolchain.cxx).toBe("clang++");
  });

  it("writes and reads a versioned results file", () => {
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "lucent-bench-")), "r.json");
    const manifest = hostManifest({ cxx: "clang++" });
    const results = [
      benchmarkResult(
        {
          scenario: "boundary/add",
          implementation: "lucent",
          manifestId: manifest.id,
          metric: "latency",
          unit: "µs",
          outputVerified: true,
        },
        [1, 2, 3],
      ),
    ];

    writeResults(file, { manifest, results });
    const read = readResults(file);

    expect(read.schemaVersion).toBe(1);
    expect(read.results).toEqual(results);
  });

  it("refuses a results file of another schema version", () => {
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "lucent-bench-")), "r.json");
    fs.writeFileSync(file, JSON.stringify({ schemaVersion: 99, results: [] }));

    expect(() => readResults(file)).toThrow(/schema version 99/);
  });
});
