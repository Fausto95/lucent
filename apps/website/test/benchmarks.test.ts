import { describe, expect, it } from "vite-plus/test";
import {
  benchmarkResult,
  type ResultsFile,
} from "../../../packages/lucent/src/cli/bench-results.ts";
import { benchmarkRun, benchmarkRuns } from "../../../scripts/website/benchmarks.ts";

const result = (scenario: string, implementation: string, samples: number[]) =>
  benchmarkResult(
    {
      scenario,
      implementation,
      manifestId: "m",
      metric: "throughput",
      unit: "ms/call",
      outputVerified: true,
    },
    samples,
  );

const file: ResultsFile = {
  schemaVersion: 1,
  manifest: {
    id: "m",
    createdAt: "2026-10-08T01:59:35.478Z",
    git: { sha: "69aa81ed44351cc4", dirty: false },
    host: { platform: "linux", arch: "x64", cpu: "Xeon", cpus: 2, memoryGb: 8, node: "v22" },
    toolchain: { cxx: "clang++", hermes: "7508017ae267ecff" },
    notes: ["host Hermes; not a device measurement"],
  },
  results: [
    result("kernels/fnv1a", "hermes-js", [330, 325, 320]),
    result("kernels/fnv1a", "lucent", [6, 7, 6.5]),
    result("kernels/only-js", "hermes-js", [1]),
    result("latency/add", "lucent", [0.18]),
    result("latency/add", "cxx-host-function", [0.163]),
    result("boundary/chatty1000", "lucent", [119.522]),
  ],
};

describe("the comparison page's benchmark tables", () => {
  it("show each kernel's medians and speedup, and each crossing beside a C++ host function's", () => {
    expect(benchmarkRun("linux-x64", file)).toEqual({
      name: "linux-x64",
      date: "2026-10-08",
      commit: "69aa81ed",
      machine: "Xeon, 2 cores, linux x64",
      toolchain: "cxx clang++, hermes 7508017a",
      notes: ["host Hermes; not a device measurement"],
      kernels: [{ name: "fnv1a", js: 325, lucent: 6.5, speedup: 50 }],
      calls: [{ name: "add(a, b), one call", lucent: 0.18, cxx: 0.163, ratio: 1.1 }],
    });
  });

  it("read every published run, each with kernels", () => {
    const runs = benchmarkRuns();
    expect(runs.length).toBeGreaterThan(0);
    for (const run of runs) expect(run.kernels.length).toBeGreaterThan(0);
  });
});
