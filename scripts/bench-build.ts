/**
 * Times the development loop on a fixture project: every differential case
 * module (packages/compiler/test/e2e/cases) in one app, built for the host
 * so no platform SDK is involved.
 *
 *   node scripts/bench-build.ts [--rounds N] [--json <file>] [--check]
 *
 * Scenarios, each run N times:
 *   build/cold                lucent build with no .lucent directory
 *   build/warm-noop           lucent build with nothing changed
 *   build/body-edit           lucent build after editing a function body
 *   check/body-edit           lucent check after editing a function body
 *   diagnostics/body-edit     the editor's diagnostics after editing a
 *                             function body: the ts-plugin in a language
 *                             service, as tsserver runs it, already warm
 *   native/body-edit          compiling the edited module's C++ unit, as
 *                             the native builds do: with the runtime's
 *                             umbrella header precompiled (cpp/lucent/
 *                             prefix.h; CMake's target_precompile_headers,
 *                             the podspec's prefix header), -O2, clang++
 *   native/body-edit-no-pch   the same unit without it, for comparison
 *
 * Wall-clock times include starting the CLI, as a developer waits for it;
 * the check step's own time comes from .lucent/build-record.json.
 * Linking and installing are not part of this loop. With
 * --check, a scenario whose p95 exceeds its budget
 * (scripts/bench-build-budgets.json: the design's feedback targets) fails.
 */
import fs from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  type BenchmarkResult,
  benchmarkResult,
  hostManifest,
  writeResults,
} from "../packages/lucent/src/cli/bench-results.ts";
import { spawnSync } from "node:child_process";
import ts from "typescript";
import * as compiler from "../packages/compiler/src/index.ts";
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
const check = args.includes("--check");
const budgets: Record<string, number> = JSON.parse(
  fs.readFileSync(path.join(root, "scripts/bench-build-budgets.json"), "utf8"),
);

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

/**
 * The editor's view of the fixture: a language service with the ts-plugin,
 * the compiler loaded; `diagnostics()` edits the body and times the
 * Lucent and TypeScript diagnostics of the edited file, as hover-free
 * typing asks for them.
 */
async function editor() {
  const { createPlugin } = createRequire(import.meta.url)(
    "../packages/lucent/ts-plugin/index.js",
  ) as {
    createPlugin: (load: () => Promise<unknown>) => ts.server.PluginModuleFactory;
  };
  const files = new Map(
    fs
      .readdirSync(app)
      .filter((f) => f.endsWith(".lucent.ts"))
      .map((f) => [
        path.join(app, f),
        { text: fs.readFileSync(path.join(app, f), "utf8"), version: 0 },
      ]),
  );
  const host: ts.LanguageServiceHost = {
    getCompilationSettings: () => ({
      strict: true,
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      allowImportingTsExtensions: true,
      noEmit: true,
      types: [],
    }),
    getScriptFileNames: () => [...files.keys()],
    getScriptVersion: (f) => String(files.get(f)?.version ?? 0),
    getScriptSnapshot: (f) => {
      const text =
        files.get(f)?.text ?? (fs.existsSync(f) ? fs.readFileSync(f, "utf8") : undefined);
      return text === undefined ? undefined : ts.ScriptSnapshot.fromString(text);
    },
    getCurrentDirectory: () => app,
    getDefaultLibFileName: (o) => ts.getDefaultLibFilePath(o),
    fileExists: (f) => files.has(f) || fs.existsSync(f),
    readFile: (f) =>
      files.get(f)?.text ?? (fs.existsSync(f) ? fs.readFileSync(f, "utf8") : undefined),
  };

  let loaded = () => {};
  const ready = new Promise<void>((resolve) => (loaded = resolve));
  const plugin = createPlugin(async () => {
    setTimeout(loaded);
    return compiler;
  })({ typescript: ts });
  const service = plugin.create({
    languageService: ts.createLanguageService(host),
    languageServiceHost: host,
    project: {
      getFileNames: () => [...files.keys()],
      refreshDiagnostics: () => {},
      projectService: { logger: { info: () => {} } },
    },
    config: {},
  } as never);
  await ready;

  return () => {
    editBody();
    const file = files.get(edited)!;
    file.text = fs.readFileSync(edited, "utf8");
    file.version++;

    const t = performance.now();
    service.getSemanticDiagnostics(edited);
    return { ms: performance.now() - t };
  };
}

/**
 * The native compile of the edited module's unit, as the native builds
 * compile it (`.lucent/native/cpp`, its headers; -O2, C++20), with the
 * prefix header precompiled once (`pch`) or not: the time of one unit.
 */
const cxx = process.env.CXX ?? "clang++";
const native = path.join(app, ".lucent/native/cpp");
const unit = path.join(native, "generated/m_basics.cpp");
const nativeFlags = () => [
  "-std=c++20",
  "-ffp-contract=off",
  "-O2",
  "-w",
  `-I${native}`,
  `-I${path.join(native, "generated/host")}`,
  `-I${path.join(native, "generated")}`,
];
const pch = path.join(app, "prefix.h.pch");
function precompile(): void {
  const r = spawnSync(
    cxx,
    [...nativeFlags(), "-x", "c++-header", path.join(native, "lucent/prefix.h"), "-o", pch],
    { encoding: "utf8" },
  );
  if (r.status !== 0) throw new Error(`precompiling prefix.h failed:\n${r.stderr}`);
}
function compileUnit(precompiled: boolean): { ms: number } {
  const t = performance.now();
  const r = spawnSync(
    cxx,
    [
      ...nativeFlags(),
      ...(precompiled ? ["-include-pch", pch] : []),
      "-c",
      unit,
      "-o",
      path.join(app, "unit.o"),
    ],
    { encoding: "utf8" },
  );
  const ms = performance.now() - t;
  if (r.status !== 0) throw new Error(`compiling ${unit} failed:\n${r.stderr}`);
  return { ms };
}
/** Only clang reads clang's precompiled headers: with another compiler, no native scenario. */
const clang = /clang/.test(spawnSync(cxx, ["--version"], { encoding: "utf8" }).stdout ?? "");

// One warmup build: the first run compiles nothing but loads everything.
lucent("build");
const diagnostics = await editor();
diagnostics();

for (let i = 0; i < rounds; i++) {
  fs.rmSync(path.join(app, ".lucent"), { recursive: true, force: true });
  add("build/cold", lucent("build"));

  add("build/warm-noop", lucent("build"));

  editBody();
  add("build/body-edit", lucent("build"));

  editBody();
  add("check/body-edit", lucent("check"));

  add("diagnostics/body-edit", diagnostics());

  if (clang) {
    // The cold build wrote the runtime's headers again: precompiled again, as a build would.
    precompile();
    add("native/body-edit", compileUnit(true));
    add("native/body-edit-no-pch", compileUnit(false));
  }
}

const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[xs.length >> 1]!;
/** The nearest-rank 95th percentile. */
const p95 = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.ceil(0.95 * xs.length) - 1]!;

console.log(`${modules} modules, ${rounds} rounds (wall clock includes starting the CLI)\n`);
console.log("scenario                median ms   p95 ms   check step ms   budget (p95)");
const over: string[] = [];
for (const [scenario, xs] of Object.entries(samples)) {
  const checkStep = checkSamples[scenario];
  const budget = budgets[scenario];
  console.log(
    `${scenario.padEnd(23)} ${median(xs).toFixed(0).padStart(9)} ${p95(xs).toFixed(0).padStart(8)}   ${checkStep ? median(checkStep).toFixed(0).padStart(13) : "-".padStart(13)}   ${budget === undefined ? "-" : `${budget} ms`}`,
  );
  if (budget !== undefined && p95(xs) > budget)
    over.push(`${scenario}: p95 ${p95(xs).toFixed(0)} ms, budget ${budget} ms`);
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

if (check && over.length) {
  console.error(`\nover budget:\n${over.map((o) => `  ${o}`).join("\n")}`);
  process.exit(1);
}
