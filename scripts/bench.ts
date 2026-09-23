/**
 * Times the benchmark kernels (packages/compiler/test/e2e/cases/kernels.lucent.ts)
 * in one Hermes runtime: compiled by Lucent to C++ and called over JSI, against
 * the same TypeScript run as JavaScript. Sizes come from kernels.bench.json.
 *
 *   HERMES_DIR=~/hermes tsx scripts/bench.ts [scale] [--check]
 *
 * --check fails when a kernel's speedup is below its minimum in
 * scripts/bench-budgets.json (the performance budget CI enforces).
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { compile, report } from "../packages/compiler/src/index.ts";
import { cFlags, hostLibs, runtimeSources } from "../packages/runtime/test/sources.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const hermes = process.env.HERMES_DIR ?? path.join(os.homedir(), "hermes");
const cxx = process.env.CXX ?? "clang++";
const args = process.argv.slice(2);
const check = args.includes("--check");
const scale = Number(args.find((a) => !a.startsWith("--")) ?? "1");
const budgets: Record<string, number> = JSON.parse(fs.readFileSync(path.join(root, "scripts/bench-budgets.json"), "utf8"));
const kernels = path.join(root, "packages/compiler/test/e2e/cases/kernels.lucent.ts");
const sizes: Record<string, number> = JSON.parse(fs.readFileSync(kernels.replace(/\.lucent\.ts$/, ".bench.json"), "utf8"));
const work = path.join(os.tmpdir(), "lucent-bench");
const runtime = path.join(root, "packages/runtime/cpp");

function sh(cmd: string, args: string[]): void {
  const r = spawnSync(cmd, args, { encoding: "utf8", maxBuffer: 64 << 20 });
  if (r.status !== 0) throw new Error(`${cmd} failed:\n${r.stderr}\n${r.stdout}`);
}

fs.rmSync(work, { recursive: true, force: true });
fs.mkdirSync(work, { recursive: true });

// Native: the kernels compiled like a release build of the app.
const result = compile([kernels]);
if (!result.ok) throw new Error(report(result.diagnostics));
for (const [name, content] of result.files) fs.writeFileSync(path.join(work, name), content);
const flags = ["-std=c++20", "-ffp-contract=off", "-O2", "-DNDEBUG", "-w", `-I${runtime}`, `-I${work}`, `-I${hermes}/API`, `-I${hermes}/API/jsi`, `-I${hermes}/public`];
const rs = runtimeSources(runtime);
const sources = [
  ...[...result.files.keys()].filter((f) => f.endsWith(".cpp")).map((f) => path.join(work, f)),
  ...rs.cxx,
  ...rs.c,
  path.join(root, "packages/runtime/test/jsi/harness.cpp"),
];
const objs = sources.map((s, i) => {
  const o = path.join(work, `${i}_${path.basename(s).replace(/\.(cpp|c)$/, "")}.o`);
  if (s.endsWith(".c")) sh(process.env.CC ?? "clang", [...cFlags, "-c", s, "-o", o]);
  else sh(cxx, [...flags, "-c", s, "-o", o]);
  return o;
});
const exe = path.join(work, "bench-host");
sh(cxx, [...objs, `-L${hermes}/build/lib`, `-L${hermes}/build/jsi`, "-lhermesvm", "-ljsi", "-lpthread", ...hostLibs, `-Wl,-rpath,${hermes}/build/lib`, `-Wl,-rpath,${hermes}/build/jsi`, "-o", exe]);

// JavaScript: the same source, transpiled, in the same Hermes runtime.
const js = ts.transpileModule(fs.readFileSync(kernels, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2019 } }).outputText;
const script = path.join(work, "bench.js");
fs.writeFileSync(
  script,
  `var jsKernels = (function () { var module = { exports: {} }; var exports = module.exports;\n${js}\nreturn module.exports; })();
var native = __lucent.kernels;
var sizes = ${JSON.stringify(sizes)};
var scale = ${scale};
// Milliseconds per call: the best of 5 rounds, each repeating the call for
// at least 30 ms so that fast kernels are measured beyond the clock's
// resolution.
function best(f, n) {
  var min = Infinity;
  for (var r = 0; r < 5; r++) {
    var t = Date.now(), calls = 0, elapsed;
    do {
      f(n);
      calls++;
      elapsed = Date.now() - t;
    } while (elapsed < 30);
    min = Math.min(min, elapsed / calls);
  }
  return min;
}
for (var name in sizes) {
  var n = Math.max(1, Math.round(sizes[name] * scale));
  var same = jsKernels[name](n) === native[name](n);
  print(JSON.stringify({ name: name, n: n, js: best(jsKernels[name], n), native: best(native[name], n), same: same }));
}
`,
);
const r = spawnSync(exe, [script], { encoding: "utf8", timeout: 600000 });
if (r.status !== 0) throw new Error(`bench failed:\n${r.stderr}\n${r.stdout}`);
const rows = r.stdout.trim().split("\n").map((l) => JSON.parse(l) as { name: string; n: number; js: number; native: number; same: boolean });
console.log(`kernel        size       JS (ms)  Lucent (ms)  speedup  budget`);
const failures: string[] = [];
for (const row of rows) {
  const speedup = row.js / row.native;
  const budget = budgets[row.name];
  if (budget === undefined) failures.push(`${row.name}: no budget in scripts/bench-budgets.json`);
  else if (speedup < budget) failures.push(`${row.name}: ${speedup.toFixed(1)}x, budget ${budget}x`);
  if (!row.same) failures.push(`${row.name}: results differ from JavaScript`);
  console.log(
    `${row.name.padEnd(13)} ${String(row.n).padEnd(10)} ${row.js.toFixed(1).padStart(7)}  ${row.native.toFixed(2).padStart(11)}  ${`${speedup.toFixed(1)}x`.padStart(7)}  ${budget === undefined ? "-" : `${budget}x`}${row.same ? "" : "  RESULTS DIFFER"}`,
  );
}
if (rows.some((row) => !row.same) || (check && failures.length)) {
  console.error(`\n${failures.join("\n")}`);
  process.exit(1);
}
