/**
 * Times the benchmark kernels (packages/compiler/test/e2e/cases/kernels.lucent.ts)
 * in one Hermes runtime: compiled by Lucent to C++ and called over JSI, against
 * the same TypeScript run as JavaScript. Sizes come from kernels.bench.json.
 *
 *   HERMES_DIR=~/hermes node scripts/bench.ts [scale] [--check]
 *
 * --check fails when a kernel's speedup is below its minimum in
 * scripts/bench-budgets.json (the performance budget CI enforces).
 *
 * Then the boundary: what crossing between JavaScript and Lucent costs
 * (cases/boundary.lucent.ts). Batching work into one call must be cheaper
 * than calling once per item: --check fails when a batched case costs more
 * than its budget times 1,000 chatty add() calls
 * (scripts/bench-boundary-budgets.json). And a single call must cost about
 * what a C++ TurboModule's does: add() and concat() are timed again as bare
 * host functions (scripts/bench-floor.cpp), and --check fails when Lucent's
 * costs more than its budget times that (scripts/bench-floor-budgets.json).
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
const budgets: Record<string, number> = JSON.parse(
  fs.readFileSync(path.join(root, "scripts/bench-budgets.json"), "utf8"),
);
const kernels = path.join(root, "packages/compiler/test/e2e/cases/kernels.lucent.ts");
const boundary = path.join(root, "packages/compiler/test/e2e/cases/boundary.lucent.ts");
const boundaryBudgets: Record<string, number> = JSON.parse(
  fs.readFileSync(path.join(root, "scripts/bench-boundary-budgets.json"), "utf8"),
);
const floorBudgets: Record<string, number> = JSON.parse(
  fs.readFileSync(path.join(root, "scripts/bench-floor-budgets.json"), "utf8"),
);
const sizes: Record<string, number> = JSON.parse(
  fs.readFileSync(kernels.replace(/\.lucent\.ts$/, ".bench.json"), "utf8"),
);
const work = path.join(os.tmpdir(), "lucent-bench");
const runtime = path.join(root, "packages/runtime/cpp");

function sh(cmd: string, args: string[]): void {
  const r = spawnSync(cmd, args, { encoding: "utf8", maxBuffer: 64 << 20 });
  if (r.status !== 0) throw new Error(`${cmd} failed:\n${r.stderr}\n${r.stdout}`);
}

fs.rmSync(work, { recursive: true, force: true });
fs.mkdirSync(work, { recursive: true });

// Native: the kernels compiled like a release build of the app.
const result = compile([kernels, boundary]);
if (!result.ok) throw new Error(report(result.diagnostics));
for (const [name, content] of result.files) fs.writeFileSync(path.join(work, name), content);
const flags = [
  "-std=c++20",
  "-ffp-contract=off",
  "-O2",
  "-DNDEBUG",
  "-w",
  `-I${runtime}`,
  `-I${work}`,
  `-I${hermes}/API`,
  `-I${hermes}/API/jsi`,
  `-I${hermes}/public`,
];
const rs = runtimeSources(runtime);
const sources = [
  ...[...result.files.keys()].filter((f) => f.endsWith(".cpp")).map((f) => path.join(work, f)),
  ...rs.cxx,
  ...rs.c,
  path.join(root, "packages/runtime/test/jsi/harness.cpp"),
  path.join(root, "scripts/bench-floor.cpp"),
];
const objs = sources.map((s, i) => {
  const o = path.join(work, `${i}_${path.basename(s).replace(/\.(cpp|c)$/, "")}.o`);
  if (s.endsWith(".c")) sh(process.env.CC ?? "clang", [...cFlags, "-c", s, "-o", o]);
  else sh(cxx, [...flags, "-c", s, "-o", o]);
  return o;
});
const exe = path.join(work, "bench-host");
sh(cxx, [
  ...objs,
  `-L${hermes}/build/lib`,
  `-L${hermes}/build/jsi`,
  "-lhermesvm",
  "-ljsi",
  "-lpthread",
  ...hostLibs,
  `-Wl,-rpath,${hermes}/build/lib`,
  `-Wl,-rpath,${hermes}/build/jsi`,
  "-o",
  exe,
]);

// JavaScript: the same source, transpiled, in the same Hermes runtime.
const js = ts.transpileModule(fs.readFileSync(kernels, "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2019 },
}).outputText;
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
// The boundary, natively: each case in microseconds per run.
var b = __lucent.boundary;
var points = []; for (var i = 0; i < 1000; i++) points.push({ x: i, y: 1000 - i });
var numbers = []; for (var i = 0; i < 1000; i++) numbers.push(i);
var boundaryCases = {
  chatty1000: function () { var s = 0; for (var i = 0; i < 1000; i++) s = b.add(s, i); return s; },
  structsIn1000: function () { return b.sumPoints(points); },
  structsOut1000: function () { return b.makePoints(1000).length; },
  numbersIn1000: function () { return b.sumNumbers(numbers); },
  strings1000: function () { var s = ""; for (var i = 0; i < 1000; i++) s = b.concat("hello ", "world"); return s; },
  // The same calls to bare host functions: what a C++ TurboModule costs.
  floorChatty1000: function () { var f = __floor, s = 0; for (var i = 0; i < 1000; i++) s = f.add(s, i); return s; },
  floorStrings1000: function () { var f = __floor, s = ""; for (var i = 0; i < 1000; i++) s = f.concat("hello ", "world"); return s; },
};
for (var name in boundaryCases) print(JSON.stringify({ boundary: name, us: best(boundaryCases[name]) * 1000 }));
for (var name in sizes) {
  var n = Math.max(1, Math.round(sizes[name] * scale));
  var same = jsKernels[name](n) === native[name](n);
  print(JSON.stringify({ name: name, n: n, js: best(jsKernels[name], n), native: best(native[name], n), same: same }));
}
`,
);
const r = spawnSync(exe, [script], { encoding: "utf8", timeout: 600000 });
if (r.status !== 0) throw new Error(`bench failed:\n${r.stderr}\n${r.stdout}`);
const lines = r.stdout
  .trim()
  .split("\n")
  .map((l) => JSON.parse(l) as Record<string, unknown>);
const rows = lines.filter((l) => "name" in l) as {
  name: string;
  n: number;
  js: number;
  native: number;
  same: boolean;
}[];
const crossings = lines.filter((l) => "boundary" in l) as { boundary: string; us: number }[];
console.log(`kernel        size       JS (ms)  Lucent (ms)  speedup  budget`);
const failures: string[] = [];
for (const row of rows) {
  const speedup = row.js / row.native;
  const budget = budgets[row.name];
  if (budget === undefined) failures.push(`${row.name}: no budget in scripts/bench-budgets.json`);
  else if (speedup < budget)
    failures.push(`${row.name}: ${speedup.toFixed(1)}x, budget ${budget}x`);
  if (!row.same) failures.push(`${row.name}: results differ from JavaScript`);
  console.log(
    `${row.name.padEnd(13)} ${String(row.n).padEnd(10)} ${row.js.toFixed(1).padStart(7)}  ${row.native.toFixed(2).padStart(11)}  ${`${speedup.toFixed(1)}x`.padStart(7)}  ${budget === undefined ? "-" : `${budget}x`}${row.same ? "" : "  RESULTS DIFFER"}`,
  );
}
const us = (name: string) => crossings.find((c) => c.boundary === name)!.us;
const chatty = us("chatty1000");
console.log(`\nboundary          µs/run   vs 1,000 add() calls  budget`);
for (const c of crossings.filter((c) => !c.boundary.startsWith("floor"))) {
  const ratio = c.us / chatty;
  const budget = boundaryBudgets[c.boundary];
  if (budget !== undefined && ratio > budget)
    failures.push(`${c.boundary}: ${ratio.toFixed(2)}x the cost of 1,000 calls, budget ${budget}x`);
  console.log(
    `${c.boundary.padEnd(16)} ${c.us.toFixed(1).padStart(7)}   ${`${ratio.toFixed(2)}x`.padStart(20)}  ${budget === undefined ? "-" : `${budget}x`}`,
  );
}
console.log(`\none call          Lucent µs  C++ TurboModule µs  ratio  budget`);
for (const [name, budget] of Object.entries(floorBudgets)) {
  const floor = us(`floor${name[0]!.toUpperCase()}${name.slice(1)}`);
  const ratio = us(name) / floor;
  if (ratio > budget)
    failures.push(`${name}: ${ratio.toFixed(2)}x a C++ TurboModule's call, budget ${budget}x`);
  console.log(
    `${name.padEnd(16)} ${us(name).toFixed(1).padStart(9)}  ${floor.toFixed(1).padStart(18)}  ${`${ratio.toFixed(2)}x`.padStart(5)}  ${budget}x`,
  );
}
if (rows.some((row) => !row.same) || (check && failures.length)) {
  console.error(`\n${failures.join("\n")}`);
  process.exit(1);
}
