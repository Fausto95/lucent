/**
 * Times the benchmark kernels (packages/compiler/test/e2e/cases/kernels.lucent.ts)
 * in one Hermes runtime: compiled by Lucent to C++ and called over JSI, against
 * the same TypeScript run as JavaScript. Sizes come from kernels.bench.json.
 *
 *   HERMES_DIR=~/hermes tsx scripts/bench.ts [scale]
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { compile, report } from "../packages/compiler/src/index.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const hermes = process.env.HERMES_DIR ?? path.join(os.homedir(), "hermes");
const cxx = process.env.CXX ?? "clang++";
const scale = Number(process.argv[2] ?? "1");
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
const sources = [
  ...[...result.files.keys()].filter((f) => f.endsWith(".cpp")).map((f) => path.join(work, f)),
  ...fs.readdirSync(path.join(runtime, "lucent")).filter((f) => f.endsWith(".cpp")).map((f) => path.join(runtime, "lucent", f)),
  ...fs.readdirSync(path.join(runtime, "lucent/jsi")).filter((f) => f.endsWith(".cpp")).map((f) => path.join(runtime, "lucent/jsi", f)),
  path.join(root, "packages/runtime/test/jsi/harness.cpp"),
];
const objs = sources.map((s, i) => {
  const o = path.join(work, `${i}_${path.basename(s, ".cpp")}.o`);
  sh(cxx, [...flags, "-c", s, "-o", o]);
  return o;
});
const exe = path.join(work, "bench-host");
sh(cxx, [...objs, `-L${hermes}/build/lib`, `-L${hermes}/build/jsi`, "-lhermesvm", "-ljsi", "-lpthread", `-Wl,-rpath,${hermes}/build/lib`, `-Wl,-rpath,${hermes}/build/jsi`, "-o", exe]);

// JavaScript: the same source, transpiled, in the same Hermes runtime.
const js = ts.transpileModule(fs.readFileSync(kernels, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2019 } }).outputText;
const script = path.join(work, "bench.js");
fs.writeFileSync(
  script,
  `var jsKernels = (function () { var module = { exports: {} }; var exports = module.exports;\n${js}\nreturn module.exports; })();
var native = __lucent.kernels;
var sizes = ${JSON.stringify(sizes)};
var scale = ${scale};
function best(f, n) {
  var min = Infinity;
  for (var r = 0; r < 5; r++) {
    var t = Date.now();
    f(n);
    min = Math.min(min, Date.now() - t);
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
console.log(`kernel        size       JS (ms)  Lucent (ms)  speedup`);
for (const row of rows) {
  const speedup = row.native > 0 ? `${(row.js / row.native).toFixed(1)}x` : "∞";
  console.log(`${row.name.padEnd(13)} ${String(row.n).padEnd(10)} ${String(row.js).padStart(7)}  ${String(row.native).padStart(11)}  ${speedup.padStart(7)}${row.same ? "" : "  RESULTS DIFFER"}`);
}
if (rows.some((row) => !row.same)) process.exit(1);
