/**
 * Times the development loop on a fixture project: every differential case
 * module (packages/compiler/test/e2e/cases) in one app, built for the host
 * so no platform SDK is involved.
 *
 *   node scripts/bench-build.ts [--rounds N] [--json <file>]
 *
 * Scenarios, each run N times:
 *   build/cold        lucent build with no .lucent directory
 *   build/warm-noop   lucent build with nothing changed
 *   build/body-edit   lucent build after editing a function body
 *   check/body-edit   lucent check after editing a function body
 *
 * Wall-clock times include starting the CLI, as a developer waits for it;
 * the check step's own time comes from .lucent/build-record.json.
 * Native compile, link and install are not part of this loop.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  type BenchmarkResult,
  benchmarkResult,
  hostManifest,
  writeResults,
} from "../packages/lucent/src/cli/bench-results.ts";
import { runLucent } from "../packages/lucent/test/run-to-exit.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cases = path.join(root, "packages/compiler/test/e2e/cases");

const args = process.argv.slice(2);
const option = (name: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const rounds = Number(option("--rounds") ?? "7");
const jsonFile = option("--json");

// The fixture: every case module, shared (no platform files).
const app = fs.mkdtempSync(path.join(os.tmpdir(), "lucent-bench-build-"));
for (const f of fs.readdirSync(cases).filter((f) => f.endsWith(".lucent.ts")))
  fs.copyFileSync(path.join(cases, f), path.join(app, f));

const edited = path.join(app, "basics.lucent.ts");
const original = fs.readFileSync(edited, "utf8");
const modules = fs.readdirSync(app).filter((f) => f.endsWith(".lucent.ts")).length;

function lucent(command: "build" | "check"): { ms: number; checkMs?: number } {
  const targets = command === "build" ? ["--platforms", "host"] : [];

  const t = performance.now();
  const r = runLucent([command, ...targets, "--root", app], {
    env: { ...process.env, NO_COLOR: "1" },
    timeout: 300_000,
  });
  const ms = performance.now() - t;

  if (r.status !== 0) throw new Error(`lucent ${command} failed:\n${r.stdout}${r.stderr}`);

  const record = JSON.parse(fs.readFileSync(path.join(app, ".lucent/build-record.json"), "utf8"));
  return { ms, checkMs: record.timings?.check };
}

// A body edit that changes the generated C++ but no signature.
let edits = 0;
function editBody(): void {
  edits++;
  fs.writeFileSync(
    edited,
    `${original}\nexport function benchEdit(): number { return ${edits}; }\n`,
  );
}

const samples: Record<string, number[]> = {};
const checkSamples: Record<string, number[]> = {};
const add = (scenario: string, r: { ms: number; checkMs?: number }) => {
  (samples[scenario] ??= []).push(r.ms);
  if (r.checkMs !== undefined) (checkSamples[scenario] ??= []).push(r.checkMs);
};

// One warmup build: the first run compiles nothing but loads everything.
lucent("build");

for (let i = 0; i < rounds; i++) {
  fs.rmSync(path.join(app, ".lucent"), { recursive: true, force: true });
  add("build/cold", lucent("build"));

  add("build/warm-noop", lucent("build"));

  editBody();
  add("build/body-edit", lucent("build"));

  editBody();
  add("check/body-edit", lucent("check"));
}

const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[xs.length >> 1]!;

console.log(`${modules} modules, ${rounds} rounds (wall clock includes starting the CLI)\n`);
console.log("scenario           median ms   check step ms");
for (const [scenario, xs] of Object.entries(samples)) {
  const check = checkSamples[scenario];
  console.log(
    `${scenario.padEnd(18)} ${median(xs).toFixed(0).padStart(9)}   ${check ? median(check).toFixed(0).padStart(13) : "-".padStart(13)}`,
  );
}

if (jsonFile) {
  const manifest = hostManifest(
    { node: process.version },
    { cwd: root, notes: [`fixture: ${modules} e2e case modules, host build`] },
  );
  const results: BenchmarkResult[] = [];

  for (const [scenario, xs] of Object.entries(samples)) {
    const shared = {
      manifestId: manifest.id,
      implementation: "lucent",
      metric: "build" as const,
      unit: "ms",
      outputVerified: false,
    };

    results.push(
      benchmarkResult(
        { ...shared, scenario: `feedback/${scenario}`, note: "wall clock, CLI start included" },
        xs,
      ),
    );

    const check = checkSamples[scenario];
    if (check?.length)
      results.push(
        benchmarkResult({ ...shared, scenario: `feedback/${scenario}/check-step` }, check),
      );
  }

  writeResults(path.resolve(jsonFile), { manifest, results });
  console.log(`\nresults: ${path.resolve(jsonFile)}`);
}

fs.rmSync(app, { recursive: true, force: true });
