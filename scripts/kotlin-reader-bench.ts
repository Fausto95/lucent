/**
 * Compares the two Kotlin metadata readers: the official kotlin-metadata-jvm
 * library in a JVM process (packages/bindgen/kotlin-helper) and the
 * TypeScript decoder (packages/bindgen/src/kotlin-metadata-reader.ts).
 *
 *   node scripts/kotlin-reader-bench.ts [--runs N] [artifact.jar|.aar …]
 *
 * Over the Kotlin fixture library, and over real artifacts (by default the
 * Kotlin and AndroidX libraries of the local Gradle cache listed below, where
 * present), it prints as Markdown:
 *
 * - installation size: what each reader needs at run time;
 * - process startup: each reader's process run over no input;
 * - cold extraction: a fresh process per run, reading the batch and writing
 *   its JSON (median and best of N runs, wall clock);
 * - warm extraction: the same batch read again in the same process;
 * - peak memory: the maximum resident set size of the cold runs;
 * - fidelity: declarations whose normalized output differs between readers.
 *
 * Needs kotlinc (with its lib directory), a JDK (JAVA_HOME, else java on
 * PATH) and /usr/bin/time. With --read-ts it is instead the TypeScript
 * reader's process: it prints the batch for its inputs.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual } from "node:util";
import zlib from "node:zlib";
import type {
  KotlinDeclaration,
  KotlinMetadataBatch,
} from "../packages/bindgen/src/kotlin-metadata.ts";
import { readKotlinMetadata } from "../packages/bindgen/src/kotlin-metadata-reader.ts";
import {
  buildHelper,
  compileKotlin,
  helperClasspath,
  kotlinFixtures,
  kotlinSources,
  kotlinToolchain,
  readWithHelper,
} from "../packages/bindgen/test/kotlin-toolchain.ts";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

/** Gradle coordinates (group/artifact/version) looked up in the local cache. */
const GRADLE_ARTIFACTS = [
  "org.jetbrains.kotlin/kotlin-stdlib/2.3.0",
  "org.jetbrains.kotlin/kotlin-stdlib/1.9.0",
  "org.jetbrains.kotlinx/kotlinx-coroutines-core-jvm/1.10.2",
  "org.jetbrains.kotlinx/kotlinx-serialization-core-jvm/1.7.3",
  "org.jetbrains.kotlinx/kotlinx-serialization-json-jvm/1.6.3",
  "org.jetbrains.kotlinx/kotlinx-datetime-jvm/0.7.1",
  "com.squareup.okio/okio/2.9.0",
  "com.squareup.okio/okio-jvm/3.16.0",
  "com.squareup.okhttp3/okhttp/4.12.0",
  "androidx.core/core-ktx/1.17.0",
  "androidx.collection/collection-jvm/1.5.0",
  "androidx.lifecycle/lifecycle-runtime-android/2.10.0",
  "androidx.compose.runtime/runtime-android/1.10.5",
  "androidx.compose.foundation/foundation-android/1.10.5",
];

const TS_SOURCES = [
  "packages/bindgen/src/kotlin-metadata.ts",
  "packages/bindgen/src/kotlin-metadata-reader.ts",
  "packages/bindgen/src/kotlin-metadata-decode.ts",
];

interface Command {
  command: string;
  args: string[];
}

interface Timing {
  medianMs: number;
  bestMs: number;
  peakRssMb: number;
}

const args = process.argv.slice(2);

if (args[0] === "--read-ts") readTsProcess(args.slice(1));
else await main(args);

/** The TypeScript reader as its own process, as the JVM helper is. */
function readTsProcess(argv: string[]): void {
  const iterations = argv[0] === "--iterations" ? Number(argv[1]) : 1;
  const inputs = argv[0] === "--iterations" ? argv.slice(2) : argv;
  let batch: KotlinMetadataBatch | undefined;

  for (let i = 1; i <= iterations; i++) {
    const start = performance.now();
    batch = readKotlinMetadata(inputs);
    if (iterations > 1) console.error(`iteration ${i}: ${performance.now() - start} ms`);
  }

  process.stdout.write(`${JSON.stringify(batch)}\n`);
}

async function main(argv: string[]): Promise<void> {
  const runs = argv[0] === "--runs" ? Number(argv[1]) : 5;
  const explicit = argv[0] === "--runs" ? argv.slice(2) : argv;

  const tc = kotlinToolchain();
  if (!tc)
    throw new Error("needs kotlinc (with kotlin-metadata-jvm.jar in its lib), java and javac");

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lucent-kotlin-bench-"));
  const [fixtureJar, helperJar] = await Promise.all([
    compileKotlin(tc, kotlinSources(kotlinFixtures), path.join(dir, "fixture.jar")),
    buildHelper(tc, path.join(dir, "helper.jar")),
  ]);

  const real = explicit.length > 0 ? explicit : gradleArtifacts();
  const jvm = (inputs: string[], iterations = 1): Command => ({
    command: tc.java,
    args: [
      "-cp",
      helperClasspath(tc, helperJar).join(path.delimiter),
      "lucent.kotlinmetadata.Main",
      ...(iterations > 1 ? ["--iterations", String(iterations)] : []),
      ...inputs,
    ],
  });
  const typescript = (inputs: string[], iterations = 1): Command => ({
    command: process.execPath,
    args: [
      fileURLToPath(import.meta.url),
      "--read-ts",
      ...(iterations > 1 ? ["--iterations", String(iterations)] : []),
      ...inputs,
    ],
  });

  const javaVersion = spawnSync(tc.java, ["-version"], { encoding: "utf8" }).stderr.split("\n")[0];
  const kotlinc = spawnSync(tc.kotlinc, ["-version"], { encoding: "utf8" }).stderr.trim();
  const load = os.loadavg().map((l) => l.toFixed(1));

  console.log(`# Kotlin metadata readers\n`);
  console.log(
    `- machine: ${os.cpus()[0]?.model}, ${os.cpus().length} cores, load ${load.join(" ")}`,
  );
  console.log(`- ${javaVersion}; ${kotlinc}; node ${process.version}; ${runs} runs each`);
  console.log(`- real inputs (${real.length}, ${mb(sum(real.map(size)))} MB):`);
  for (const input of real) console.log(`  - ${path.basename(input)} (${mb(size(input))} MB)`);

  const jars = helperClasspath(tc, helperJar);
  const jarList = jars.map((j) => `${path.basename(j)} ${size(j)}`).join(", ");
  const sources = TS_SOURCES.map((s) => fs.readFileSync(path.join(root, s)));
  const sourceList = TS_SOURCES.map((s, i) => `${path.basename(s)} ${sources[i]!.length}`).join(
    ", ",
  );
  const gzipped = sum(sources.map((s) => zlib.gzipSync(s).length));

  console.log(`\n## Installation size\n`);
  console.log(`| reader | files | bytes |\n| --- | --- | --- |`);
  console.log(`| JVM | ${jarList} | ${sum(jars.map(size))} (+ a JDK) |`);
  console.log(
    `| TypeScript | ${sourceList} | ${sum(sources.map((s) => s.length))} source, ${gzipped} gzipped |`,
  );

  console.log(`\n## Time and memory\n`);
  console.log(`| measure | JVM | TypeScript |\n| --- | --- | --- |`);
  row("startup (no input)", time(jvm([]), runs), time(typescript([]), runs));
  row("cold, fixture", time(jvm([fixtureJar]), runs), time(typescript([fixtureJar]), runs));
  row("cold, real inputs", time(jvm(real), runs), time(typescript(real), runs));

  const warmFixture = [warm(jvm([fixtureJar], 10)), warm(typescript([fixtureJar], 10))];
  const warmReal = [warm(jvm(real, runs + 1)), warm(typescript(real, runs + 1))];
  console.log(`| warm, fixture (median of iterations 2–10) | ${warmFixture.join(" ms | ")} ms |`);
  console.log(
    `| warm, real inputs (median of iterations 2–${runs + 1}) | ${warmReal.join(" ms | ")} ms |`,
  );

  console.log(`\n## Fidelity\n`);
  fidelity(readWithHelper(tc, helperJar, real), readKotlinMetadata(real));
}

function row(name: string, a: Timing, b: Timing): void {
  const cell = (t: Timing) =>
    `${t.medianMs.toFixed(0)} ms (best ${t.bestMs.toFixed(0)}), ${t.peakRssMb.toFixed(0)} MB RSS`;
  console.log(`| ${name} | ${cell(a)} | ${cell(b)} |`);
}

/** Wall clock of fresh processes, and their peak resident memory from /usr/bin/time. */
function time(c: Command, runs: number): Timing {
  const samples: number[] = [];
  let peak = 0;
  const flag = process.platform === "darwin" ? "-l" : "-v";

  for (let i = 0; i < runs; i++) {
    const start = performance.now();
    const result = spawnSync("/usr/bin/time", [flag, c.command, ...c.args], {
      stdio: ["ignore", "ignore", "pipe"],
      encoding: "utf8",
      maxBuffer: 1 << 26,
    });
    samples.push(performance.now() - start);
    if (result.status !== 0) throw new Error(`${c.command} failed: ${result.stderr}`);

    // macOS: "<bytes>  maximum resident set size"; Linux: "Maximum resident set size (kbytes): <kb>".
    const mac = /(\d+)\s+maximum resident set size/.exec(result.stderr);
    const linux = /Maximum resident set size \(kbytes\): (\d+)/.exec(result.stderr);
    const bytes = mac ? Number(mac[1]) : linux ? Number(linux[1]) * 1024 : 0;
    peak = Math.max(peak, bytes / 2 ** 20);
  }

  samples.sort((a, b) => a - b);
  return {
    medianMs: samples[Math.floor(samples.length / 2)]!,
    bestMs: samples[0]!,
    peakRssMb: peak,
  };
}

/** The median in-process time after the first iteration, from the reader's own report. */
function warm(c: Command): string {
  const result = spawnSync(c.command, c.args, {
    stdio: ["ignore", "ignore", "pipe"],
    encoding: "utf8",
    maxBuffer: 1 << 26,
  });
  if (result.status !== 0) throw new Error(`${c.command} failed: ${result.stderr}`);

  const times = [...result.stderr.matchAll(/iteration \d+: ([\d.]+) ms/g)].map((m) => Number(m[1]));
  const later = times.slice(1).sort((a, b) => a - b);
  return later[Math.floor(later.length / 2)]!.toFixed(0);
}

function fidelity(jvm: KotlinMetadataBatch, ts: KotlinMetadataBatch): void {
  const typescript = JSON.parse(JSON.stringify(ts)) as KotlinMetadataBatch;
  const examples: string[] = [];
  let declarations = 0;
  let functions = 0;
  let properties = 0;
  let mismatches = 0;

  console.log(
    `| input | declarations | functions | properties | metadata versions | mismatches |\n| --- | --- | --- | --- | --- | --- |`,
  );

  jvm.inputs.forEach((input, i) => {
    const other = new Map(typescript.inputs[i]!.declarations.map((d) => [d.jvmName, d]));
    const members = (d: KotlinDeclaration, key: "functions" | "properties") =>
      key in d ? (d as unknown as Record<string, unknown[]>)[key]!.length : 0;
    let differing = 0;

    for (const d of input.declarations) {
      const o = other.get(d.jvmName);
      if (isDeepStrictEqual(d, o)) continue;

      differing++;
      if (examples.length < 5) examples.push(`${d.jvmName}: ${firstDifference(d, o)}`);
    }
    differing += Math.max(0, other.size - input.declarations.length);

    const fns = sum(input.declarations.map((d) => members(d, "functions")));
    const props = sum(input.declarations.map((d) => members(d, "properties")));
    const versions = [...new Set(input.declarations.map((d) => d.metadataVersion))]
      .sort()
      .join(", ");
    console.log(
      `| ${path.basename(input.path)} | ${input.declarations.length} | ${fns} | ${props} | ${versions} | ${differing} |`,
    );

    declarations += input.declarations.length;
    functions += fns;
    properties += props;
    mismatches += differing;
  });

  console.log(`| total | ${declarations} | ${functions} | ${properties} | | ${mismatches} |`);
  if (examples.length > 0)
    console.log(`\nFirst differences:\n\n${examples.map((e) => `- ${e}`).join("\n")}`);
}

function firstDifference(a: unknown, b: unknown, at = ""): string {
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) {
    return `${at || "/"}: ${JSON.stringify(a)} ≠ ${JSON.stringify(b)}`;
  }

  for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) {
    const x = (a as Record<string, unknown>)[key];
    const y = (b as Record<string, unknown>)[key];
    if (!isDeepStrictEqual(x, y)) return firstDifference(x, y, `${at}/${key}`);
  }

  return `${at}: equal`;
}

function gradleArtifacts(): string[] {
  const cache = path.join(os.homedir(), ".gradle/caches/modules-2/files-2.1");

  return GRADLE_ARTIFACTS.flatMap((coordinate) => {
    const [group, artifact, version] = coordinate.split("/") as [string, string, string];
    const versionDir = path.join(cache, group, artifact, version);
    if (!fs.existsSync(versionDir)) {
      console.error(`not in the Gradle cache: ${coordinate}`);
      return [];
    }

    const files = fs
      .readdirSync(versionDir, { recursive: true, encoding: "utf8" })
      .filter((f) => /\.(jar|aar)$/.test(f) && !/-(sources|javadoc)\.jar$/.test(f));
    return files.slice(0, 1).map((f) => path.join(versionDir, f));
  });
}

function size(file: string): number {
  return fs.statSync(file).size;
}

function sum(values: number[]): number {
  return values.reduce((a, b) => a + b, 0);
}

function mb(bytes: number): string {
  return (bytes / 2 ** 20).toFixed(1);
}
