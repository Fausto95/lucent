import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { compile, coreJsPath, moduleNameOf, projectFiles, runtimeDir } from "@lucent-lang/compiler";
import { cFlags, hostLibs, runtimeSources } from "@lucent-lang/runtime/sources";
import ts from "typescript";
import type { Invocation } from "../args.ts";
import { renderDiagnostic } from "../ui/diagnostic.ts";
import { table } from "../ui/format.ts";

interface CaseResult {
  file: string;
  name: string;
  js: number;
  native: number;
  speedup: number;
  same: boolean;
  error?: string;
}

const HERMES_FIX =
  "lucent bench runs your modules in a desktop Hermes: build one (git clone https://github.com/facebook/hermes ~/hermes && cmake -S ~/hermes -B ~/hermes/build -G Ninja -DCMAKE_BUILD_TYPE=Release && ninja -C ~/hermes/build hermesvm jsi), or point HERMES_DIR at a build";

/**
 * `lucent bench`: each case of the project's *.bench.ts files, timed as
 * the modules compiled to C++ (called over JSI in a desktop Hermes) and as
 * the same TypeScript run as JavaScript in that runtime.
 */
export async function run({ root, out }: Invocation): Promise<number> {
  const t = out.theme;
  const fail = (message: string) => {
    if (out.json) out.data({ ok: false, error: message });
    else out.error(`${t.error(t.symbols.fail)} ${message}`);
    return 1;
  };
  const benches = findBenches(root);
  if (!benches.length) return fail("no *.bench.ts file: next to a module, export default { name: () => call(), … }");
  const hermes = process.env.HERMES_DIR || path.join(os.homedir(), "hermes");
  if (!fs.existsSync(path.join(hermes, "build/lib")) || !fs.existsSync(path.join(hermes, "API/jsi"))) return fail(`no Hermes build at ${hermes}. ${HERMES_FIX}`);

  const files = projectFiles(root);
  // Platform code needs a device: on the desktop its modules are stubs that throw.
  const result = compile(files, { platforms: ["host"] });
  if (!result.ok) {
    for (const d of result.diagnostics) out.error(renderDiagnostic({ ...d, file: d.file && path.relative(root, d.file) }, d.file && fs.existsSync(d.file) ? fs.readFileSync(d.file, "utf8") : undefined, t));
    return 1;
  }

  const work = path.join(root, ".lucent/bench");
  const generated = path.join(work, "generated");
  fs.rmSync(generated, { recursive: true, force: true });
  for (const [name, content] of result.files) {
    const file = path.join(generated, name.replace(/^host\//, ""));
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content);
  }
  if (!out.json) out.print(t.dim("building the native host (the first run compiles the runtime)…"));
  const exe = await buildHost(work, generated, hermes);

  const script = path.join(work, "bench.js");
  fs.writeFileSync(script, benchScript(root, files, benches, result.proxies));
  const r = spawnSync(exe, [script], { encoding: "utf8", timeout: 600_000, maxBuffer: 64 << 20 });
  if (r.status !== 0) return fail(`the benchmark failed:\n${r.stderr || r.stdout}`);
  const cases = r.stdout
    .trim()
    .split("\n")
    .filter((l) => l.startsWith("{"))
    .map((l) => {
      const c = JSON.parse(l) as Omit<CaseResult, "speedup">;
      return { ...c, speedup: c.error ? 0 : c.js / c.native };
    });
  if (out.json) {
    out.data({ ok: cases.every((c) => c.same && !c.error), cases });
    return cases.every((c) => c.same && !c.error) ? 0 : 1;
  }
  const time = (ms: number) => (ms < 1 ? `${(ms * 1000).toFixed(1)} µs` : `${ms.toFixed(ms < 10 ? 2 : 1)} ms`);
  const row = (c: CaseResult) =>
    c.error ? [c.name, t.error(c.error), "", ""] : [c.name, time(c.js), time(c.native), `${c.speedup >= 1 ? t.success(`${c.speedup.toFixed(1)}x`) : t.warn(`${c.speedup.toFixed(1)}x`)}${c.same ? "" : t.error("  results differ")}`];
  // One table, a heading per bench file: the columns line up across files.
  const lines = table([["CASE", "JS", "LUCENT", "SPEEDUP"].map((h) => t.dim(h)), ...cases.map(row)], 3);
  out.print(`\n${lines[0]}`);
  cases.forEach((c, i) => {
    if (c.file !== cases[i - 1]?.file) out.print(t.bold(c.file));
    out.print(`${lines[i + 1]}`);
  });
  out.print(t.dim("\nper call, best of 5 rounds; desktop Hermes, so devices differ"));
  return cases.every((c) => c.same && !c.error) ? 0 : 1;
}

function findBenches(root: string): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.name === "node_modules" || e.name.startsWith(".") || e.name === "ios" || e.name === "android") continue;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) walk(full);
      else if (e.name.endsWith(".bench.ts")) out.push(full);
    }
  };
  walk(root);
  return out.sort();
}

/** Compiles `sources` to objects under `work/obj`, reusing an object whose source and flags are unchanged; in parallel. */
async function objects(work: string, sources: { file: string; cc: string; flags: string[] }[]): Promise<string[]> {
  const dir = path.join(work, "obj");
  fs.mkdirSync(dir, { recursive: true });
  const jobs = sources.map((s) => {
    const key = createHash("sha256").update(s.cc).update(s.flags.join(" ")).update(s.file).update(fs.readFileSync(s.file)).digest("hex").slice(0, 16);
    return { ...s, obj: path.join(dir, `${path.basename(s.file).replace(/\.\w+$/, "")}-${key}.o`) };
  });
  const todo = jobs.filter((j) => !fs.existsSync(j.obj));
  let next = 0;
  const worker = async () => {
    while (next < todo.length) {
      const j = todo[next++]!;
      await new Promise<void>((resolve, reject) => {
        const child = spawn(j.cc, [...j.flags, "-c", j.file, "-o", `${j.obj}.tmp`], { stdio: ["ignore", "ignore", "pipe"] });
        let err = "";
        child.stderr.on("data", (d: Buffer) => (err += d.toString()));
        child.on("error", reject);
        child.on("close", (code) => (code === 0 ? (fs.renameSync(`${j.obj}.tmp`, j.obj), resolve()) : reject(new Error(`${j.cc} failed on ${j.file}:\n${err}`))));
      });
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, os.availableParallelism() - 1) }, worker));
  return jobs.map((j) => j.obj);
}

/** The desktop host: the generated modules and the runtime, linked with Hermes and a JSI harness. */
async function buildHost(work: string, generated: string, hermes: string): Promise<string> {
  const cpp = path.join(runtimeDir(), "cpp");
  const cxx = process.env.CXX ?? "clang++";
  // A release build, as the app's: -O2, and no fused multiply-add (JavaScript rounds twice).
  const flags = ["-std=c++20", "-ffp-contract=off", "-O2", "-DNDEBUG", "-w", `-I${cpp}`, `-I${generated}`, `-I${hermes}/API`, `-I${hermes}/API/jsi`, `-I${hermes}/public`];
  const rs = runtimeSources(cpp);
  const sources = [
    ...fs.readdirSync(generated).filter((f) => f.endsWith(".cpp")).map((f) => ({ file: path.join(generated, f), cc: cxx, flags })),
    ...rs.cxx.map((file) => ({ file, cc: cxx, flags })),
    ...rs.c.map((file) => ({ file, cc: process.env.CC ?? "clang", flags: cFlags })),
    { file: path.join(runtimeDir(), "test/jsi/harness.cpp"), cc: cxx, flags },
  ];
  const objs = await objects(work, sources);
  const exe = path.join(work, "bench-host");
  const r = spawnSync(cxx, [...objs, `-L${hermes}/build/lib`, `-L${hermes}/build/jsi`, "-lhermesvm", "-ljsi", "-lpthread", ...hostLibs, `-Wl,-rpath,${hermes}/build/lib`, `-Wl,-rpath,${hermes}/build/jsi`, "-o", exe], { encoding: "utf8" });
  if (r.status !== 0) throw new Error(`linking the benchmark host failed:\n${r.stderr}`);
  return exe;
}

/**
 * One script for the host: every module as a CommonJS definition, and two
 * ways to resolve a *.lucent import: its transpiled source (JavaScript) or
 * its generated proxy (native). Each bench file loads in both.
 */
function benchScript(root: string, files: string[], benches: string[], proxies: Map<string, string>): string {
  const defs: Record<string, string> = {};
  const jsDeps: Record<string, Record<string, string>> = {};
  const nativeDeps: Record<string, Record<string, string>> = {};
  const transpile = (source: string) => ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2019, esModuleInterop: false } }).outputText;
  const loader = fs.readFileSync(path.join(runtimeDir(), "js/index.js"), "utf8");
  defs.core = fs.readFileSync(coreJsPath(), "utf8");
  defs.loader = loader;
  // The loader asks React Native only when no host installed the modules; this host does.
  defs["react-native"] = "module.exports = { TurboModuleRegistry: { get: function () { return undefined; } } };";
  const resolve = (from: string, spec: string): string | undefined => {
    if (spec === "lucent:core") return "core";
    if (!spec.startsWith(".")) return undefined;
    const base = path.resolve(path.dirname(from), spec);
    return [`${base}.ts`, base, `${base}.tsx`].find((f) => files.includes(f) || benches.includes(f));
  };
  const specs = (source: string) => [...source.matchAll(/(?:from|import)\s+["']([^"']+)["']/g)].map((m) => m[1]!);
  for (const file of [...files, ...benches]) {
    const source = fs.readFileSync(file, "utf8");
    defs[file] = transpile(source);
    jsDeps[file] = {};
    nativeDeps[file] = {};
    for (const spec of specs(source)) {
      const target = resolve(file, spec);
      if (!target) continue;
      jsDeps[file]![spec] = target;
      // Natively, a Lucent module is its proxy to the compiled code.
      nativeDeps[file]![spec] = files.includes(target) ? `proxy:${moduleNameOf(target)}` : target;
    }
  }
  for (const [name, proxy] of proxies) {
    defs[`proxy:${name}`] = proxy;
    nativeDeps[`proxy:${name}`] = { [`${"../".repeat(name.split("/").length - 1) || "./"}_lucent/runtime.js`]: "loader", "react-native": "react-native" };
  }
  nativeDeps.loader = {};
  return `var defs = {
${Object.entries(defs).map(([id, code]) => `${JSON.stringify(id)}: function (module, exports, require) {\n${code}\n}`).join(",\n")}
};
var deps = { js: ${JSON.stringify(jsDeps)}, native: ${JSON.stringify(nativeDeps)} };
var loaded = { js: {}, native: {} };
function load(world, id) {
  var cache = loaded[world];
  if (cache[id]) return cache[id].exports;
  var module = { exports: {} };
  cache[id] = module;
  defs[id](module, module.exports, function (spec) {
    var target = (deps[world][id] || {})[spec];
    if (target === undefined) throw new Error("cannot resolve " + spec + " from " + id);
    return load(world, target);
  });
  return module.exports;
}
// Milliseconds per call: the best of 5 rounds, each repeating the call for
// at least 30 ms, so fast cases are measured beyond the clock's resolution.
function best(f) {
  var min = Infinity;
  for (var r = 0; r < 5; r++) {
    var start = Date.now(), calls = 0, elapsed;
    do { f(); calls++; elapsed = Date.now() - start; } while (elapsed < 30);
    min = Math.min(min, elapsed / calls);
  }
  return min;
}
var benches = ${JSON.stringify(benches.map((b) => [b, path.relative(root, b)]))};
for (var i = 0; i < benches.length; i++) {
  var id = benches[i][0], file = benches[i][1];
  var js = load("js", id).default, native = load("native", id).default;
  for (var name in js) {
    try {
      var same = JSON.stringify(js[name]()) === JSON.stringify(native[name]());
      print(JSON.stringify({ file: file, name: name, js: best(js[name]), native: best(native[name]), same: same }));
    } catch (e) {
      print(JSON.stringify({ file: file, name: name, js: 0, native: 0, same: false, error: String(e && e.message || e) }));
    }
  }
}
`;
}
