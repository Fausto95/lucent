/**
 * Benchmark results as data: raw samples and their summary, linked to a
 * manifest of the machine and toolchain that produced them, so runs can be
 * compared later instead of scraped from a terminal table.
 *
 * Percentiles need enough samples to mean anything: p95 is reported from 20
 * samples, p99 from 100 (nearest rank). A throughput sample is the mean of a
 * batch of calls, so a percentile of batches is not an individual call's
 * latency; latency scenarios time calls one by one.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const RESULTS_SCHEMA_VERSION = 1;

export type Metric = "throughput" | "latency" | "frame" | "memory" | "build" | "size";

export interface BenchmarkManifest {
  id: string;
  createdAt: string;
  git?: { sha: string; dirty: boolean };
  host: {
    platform: string;
    arch: string;
    cpu: string;
    cpus: number;
    memoryGb: number;
    node: string;
  };
  toolchain: Record<string, string>;
  notes?: string[];
}

export interface Summary {
  median: number;
  min: number;
  max: number;
  p95?: number;
  p99?: number;
}

export interface BenchmarkResult extends Summary {
  scenario: string;
  implementation: string;
  manifestId: string;
  metric: Metric;
  unit: string;
  samples: number[];
  /** The implementation's output was checked against the reference's. */
  outputVerified: boolean;
  bytesCopied?: number;
  allocations?: number;
  note?: string;
}

export interface ResultsFile {
  schemaVersion: typeof RESULTS_SCHEMA_VERSION;
  manifest: BenchmarkManifest;
  results: BenchmarkResult[];
}

/** The nearest-rank percentile `p` (0–100) of sorted samples. */
function percentile(sorted: number[], p: number): number {
  const rank = Math.ceil((p / 100) * sorted.length);
  return sorted[Math.max(0, rank - 1)]!;
}

export function summarize(samples: readonly number[]): Summary {
  if (!samples.length) throw new Error("summarize: no samples");

  const sorted = [...samples].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  const median = sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;

  return {
    median,
    min: sorted[0]!,
    max: sorted.at(-1)!,
    ...(sorted.length >= 20 ? { p95: percentile(sorted, 95) } : {}),
    ...(sorted.length >= 100 ? { p99: percentile(sorted, 99) } : {}),
  };
}

export function benchmarkResult(
  fields: Omit<BenchmarkResult, keyof Summary | "samples">,
  samples: number[],
): BenchmarkResult {
  return { ...fields, samples, ...summarize(samples) };
}

function gitState(cwd: string): BenchmarkManifest["git"] {
  try {
    const sha = execFileSync("git", ["rev-parse", "HEAD"], { cwd, encoding: "utf8" }).trim();
    const status = execFileSync("git", ["status", "--porcelain"], { cwd, encoding: "utf8" });

    return { sha, dirty: status.trim().length > 0 };
  } catch {
    return undefined;
  }
}

/** The manifest of a run on this machine; `toolchain` names what built the code measured. */
export function hostManifest(
  toolchain: Record<string, string>,
  options: { cwd?: string; notes?: string[] } = {},
): BenchmarkManifest {
  const createdAt = new Date().toISOString();
  const git = gitState(options.cwd ?? process.cwd());

  return {
    id: `host-${createdAt.replace(/[:.]/g, "-")}${git ? `-${git.sha.slice(0, 8)}` : ""}`,
    createdAt,
    ...(git ? { git } : {}),
    host: {
      platform: process.platform,
      arch: process.arch,
      cpu: os.cpus()[0]?.model ?? "unknown",
      cpus: os.cpus().length,
      memoryGb: Math.round(os.totalmem() / 2 ** 30),
      node: process.version,
    },
    toolchain,
    ...(options.notes?.length ? { notes: options.notes } : {}),
  };
}

export function writeResults(
  file: string,
  data: { manifest: BenchmarkManifest; results: BenchmarkResult[] },
): void {
  const out: ResultsFile = { schemaVersion: RESULTS_SCHEMA_VERSION, ...data };

  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(out, null, 2)}\n`);
}

export function readResults(file: string): ResultsFile {
  const data = JSON.parse(fs.readFileSync(file, "utf8")) as { schemaVersion?: unknown };

  if (data.schemaVersion !== RESULTS_SCHEMA_VERSION)
    throw new Error(
      `${file}: benchmark results schema version ${String(data.schemaVersion)}; this Lucent reads ${RESULTS_SCHEMA_VERSION}`,
    );

  return data as ResultsFile;
}
