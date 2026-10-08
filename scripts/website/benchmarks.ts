import fs from "node:fs";
import path from "node:path";
import { readResults, type ResultsFile } from "../../packages/lucent/src/cli/bench-results.ts";
import { root } from "./context.ts";

/** A published run, as the comparison page's tables show it. */
export interface BenchmarkRun {
  /** Its file under benchmarks/results/, without .json. */
  name: string;
  date: string;
  commit?: string;
  machine: string;
  toolchain: string;
  notes: string[];
  /** Kernel, JavaScript and Lucent medians (ms per call), and the speedup. */
  kernels: { name: string; js: number; lucent: number; speedup: number }[];
  /** One crossing of the boundary: Lucent's median against a bare C++ host function's (µs). */
  calls: { name: string; lucent: number; cxx: number; ratio: number }[];
}

/** Three significant digits: 0.163, 9.75, 136. */
const round = (n: number): number => Number(n.toPrecision(3));

/** One results file's tables: medians, which a single fast round can't move. */
export function benchmarkRun(name: string, { manifest, results }: ResultsFile): BenchmarkRun {
  const median = (scenario: string, implementation: string) =>
    results.find((r) => r.scenario === scenario && r.implementation === implementation)?.median;
  const kernels = [...new Set(results.map((r) => r.scenario))]
    .filter((s) => s.startsWith("kernels/"))
    .flatMap((s) => {
      const js = median(s, "hermes-js");
      const lucent = median(s, "lucent");
      return js && lucent
        ? [
            {
              name: s.slice("kernels/".length),
              js: round(js),
              lucent: round(lucent),
              speedup: Number((js / lucent).toFixed(1)),
            },
          ]
        : [];
    });
  const calls = [
    ["latency/add", "add(a, b), one call"],
    ["boundary/chatty1000", "1,000 add() calls"],
    ["boundary/strings1000", "1,000 concat() calls"],
  ].flatMap(([scenario, label]) => {
    const lucent = median(scenario!, "lucent");
    const cxx = median(scenario!, "cxx-host-function");
    return lucent && cxx
      ? [
          {
            name: label!,
            lucent: round(lucent),
            cxx: round(cxx),
            ratio: Number((lucent / cxx).toFixed(2)),
          },
        ]
      : [];
  });
  const { host, toolchain } = manifest;
  return {
    name,
    date: manifest.createdAt.slice(0, 10),
    ...(manifest.git ? { commit: manifest.git.sha.slice(0, 8) } : {}),
    machine: `${host.cpu}, ${host.cpus} cores, ${host.platform} ${host.arch}`,
    toolchain: Object.entries(toolchain)
      .map(([k, v]) => `${k} ${k === "hermes" ? v.slice(0, 8) : v}`)
      .join(", "),
    notes: manifest.notes ?? [],
    kernels,
    calls,
  };
}

/** Every published run in benchmarks/results/, by file name. */
export function benchmarkRuns(): BenchmarkRun[] {
  const dir = path.join(root, "benchmarks/results");
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .sort()
    .map((f) => benchmarkRun(f.replace(/\.json$/, ""), readResults(path.join(dir, f))));
}
