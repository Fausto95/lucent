/**
 * End-to-end tests: every case is compiled to C++, built into a Hermes host,
 * and run through real JSI. The same test script also runs against the
 * module's TypeScript source executed as plain JavaScript (in Node), and the
 * two outputs must match line for line.
 *
 *   tsx packages/compiler/test/e2e/run.ts [case-name...]
 *
 * Env: HERMES_DIR (Hermes checkout built into build/), SANITIZE=1, CXX.
 */
import { execFileSync, spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import ts from "typescript";
import { compile, report } from "../../src/index.ts";

// One time zone with daylight saving time for both runs (the native host
// inherits it), so local-time code is exercised even on UTC machines.
process.env.TZ = process.env.LUCENT_TEST_TZ ?? "America/New_York";

const here = path.dirname(fileURLToPath(import.meta.url));
const casesDir = path.join(here, "cases");
const runtimeDir = path.resolve(here, "../../../runtime");
const coreJs = path.resolve(here, "../../../core/index.js");
const abortPolyfill = path.resolve(here, "../../../runtime/test/jsi/abort-polyfill.js");
const hermes = process.env.HERMES_DIR ?? path.join(os.homedir(), "hermes");
const sanitize = process.env.SANITIZE === "1";
const cxx = process.env.CXX ?? "clang++";
const work = path.join(os.tmpdir(), `lucent-e2e${sanitize ? "-san" : ""}`);

// Generated code builds with -Werror in the NDK's appmodules build; match it
// (and the podspec/CMake suppressions) so warnings fail here first.
const deviceFlags = cxx.includes("clang") ? ["-Werror", "-Wno-gnu-statement-expression", "-Wno-parentheses-equality", "-Wno-comma"] : [];

const baseFlags = [
  "-std=c++20",
  "-ffp-contract=off",
  "-g",
  "-O1",
  "-Wall",
  "-Wno-unused-parameter",
  "-Wno-unused-variable",
  "-Wno-unused-label",
  "-Wno-unused-but-set-variable",
  "-Wno-unused-function",
  `-I${path.join(runtimeDir, "cpp")}`,
  `-I${path.join(hermes, "API")}`,
  `-I${path.join(hermes, "API/jsi")}`,
  `-I${path.join(hermes, "public")}`,
  ...(sanitize ? ["-fsanitize=address,undefined", "-fno-omit-frame-pointer"] : []),
];

function sh(cmd: string, args: string[], opts: { cwd?: string } = {}): void {
  const r = spawnSync(cmd, args, { cwd: opts.cwd, encoding: "utf8", maxBuffer: 64 << 20 });
  if (r.status !== 0) throw new Error(`${cmd} ${args.slice(-3).join(" ")} failed:\n${r.stderr}\n${r.stdout}`);
}

/** Builds the runtime + harness objects once (cached by content hash). */
function runtimeLib(): string {
  const sources = [
    ...fs.readdirSync(path.join(runtimeDir, "cpp/lucent")).filter((f) => f.endsWith(".cpp")).map((f) => path.join(runtimeDir, "cpp/lucent", f)),
    ...fs.readdirSync(path.join(runtimeDir, "cpp/lucent/jsi")).filter((f) => f.endsWith(".cpp")).map((f) => path.join(runtimeDir, "cpp/lucent/jsi", f)),
    path.join(runtimeDir, "test/jsi/harness.cpp"),
  ];
  const headers = [
    ...fs.readdirSync(path.join(runtimeDir, "cpp/lucent")).filter((f) => f.endsWith(".h")).map((f) => path.join(runtimeDir, "cpp/lucent", f)),
    ...fs.readdirSync(path.join(runtimeDir, "cpp/lucent/jsi")).filter((f) => f.endsWith(".h")).map((f) => path.join(runtimeDir, "cpp/lucent/jsi", f)),
  ];
  const hash = crypto.createHash("sha1");
  for (const f of [...sources, ...headers]) hash.update(fs.readFileSync(f));
  hash.update(baseFlags.join(" "));
  const dir = path.join(work, "rt", hash.digest("hex").slice(0, 12));
  const lib = path.join(dir, "liblucentrt.a");
  if (fs.existsSync(lib)) return lib;
  fs.mkdirSync(dir, { recursive: true });
  const objs: string[] = [];
  for (const src of sources) {
    const obj = path.join(dir, path.basename(src).replace(/\.cpp$/, ".o"));
    sh(cxx, [...baseFlags, "-c", src, "-o", obj]);
    objs.push(obj);
  }
  sh("ar", ["rcs", lib, ...objs]);
  return lib;
}

interface Case {
  name: string;
  files: string[];
  test: string;
}

function cases(filter: string[]): Case[] {
  const out: Case[] = [];
  for (const entry of fs.readdirSync(casesDir, { withFileTypes: true })) {
    if (entry.isFile() && entry.name.endsWith(".test.js")) {
      const name = entry.name.replace(/\.test\.js$/, "");
      const dir = path.join(casesDir, name);
      const files = fs.existsSync(dir) && fs.statSync(dir).isDirectory()
        ? fs.readdirSync(dir).filter((f) => f.endsWith(".lucent.ts")).map((f) => path.join(dir, f))
        : [path.join(casesDir, `${name}.lucent.ts`)];
      out.push({ name, files, test: path.join(casesDir, entry.name) });
    }
  }
  return out.filter((c) => filter.length === 0 || filter.includes(c.name)).sort((a, b) => a.name.localeCompare(b.name));
}

function nativeRun(c: Case, lib: string): string {
  const result = compile(c.files);
  if (!result.ok) throw new Error(`compile errors:\n${report(result.diagnostics)}`);
  const dir = path.join(work, "cases", c.name);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  const objs: string[] = [];
  for (const [name, content] of result.files) fs.writeFileSync(path.join(dir, name), content);
  for (const name of result.files.keys()) {
    if (!name.endsWith(".cpp")) continue;
    const obj = path.join(dir, name.replace(/\.cpp$/, ".o"));
    sh(cxx, [...baseFlags, ...deviceFlags, `-I${dir}`, "-c", path.join(dir, name), "-o", obj]);
    objs.push(obj);
  }
  const exe = path.join(dir, "host");
  sh(cxx, [
    ...baseFlags,
    ...objs,
    lib,
    `-L${path.join(hermes, "build/lib")}`,
    `-L${path.join(hermes, "build/jsi")}`,
    "-lhermesvm",
    "-ljsi",
    "-lpthread",
    ...(process.platform === "darwin" ? ["-framework", "CoreFoundation"] : []),
    `-Wl,-rpath,${path.join(hermes, "build/lib")}`,
    `-Wl,-rpath,${path.join(hermes, "build/jsi")}`,
    "-o",
    exe,
  ]);
  const prelude = path.join(dir, "prelude.js");
  const moduleNames = c.files.map((f) => path.basename(f).replace(/\.lucent\.ts$/, ""));
  fs.writeFileSync(
    prelude,
    `var mods = __lucent; var mod = __lucent[${JSON.stringify(moduleNames[0])}];\n` +
      `function lucentClass(factory) { function C() { return factory.apply(undefined, arguments); } C.prototype = factory.prototype; Object.defineProperty(C.prototype, "constructor", { value: C }); for (var k of Object.keys(factory)) C[k] = factory[k]; return C; }\n`,
  );
  const r = spawnSync(exe, [abortPolyfill, prelude, c.test], { encoding: "utf8", timeout: 60000, env: { ...process.env, ASAN_OPTIONS: "detect_leaks=0" } });
  if (r.status !== 0) throw new Error(`native run failed (${r.status ?? r.signal}):\n${r.stderr}\n${r.stdout}`);
  if (r.stderr.trim()) process.stderr.write(r.stderr);
  return r.stdout;
}

async function referenceRun(c: Case): Promise<string> {
  const modules = new Map<string, unknown>();
  const load = (file: string): unknown => {
    const key = path.resolve(file);
    if (modules.has(key)) return modules.get(key);
    const exports = {};
    modules.set(key, exports);
    const src = ts.transpileModule(fs.readFileSync(key, "utf8"), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText;
    const req = (spec: string) => {
      if (spec === "@lucent-lang/core") return require_(coreJs);
      const base = path.resolve(path.dirname(key), spec);
      for (const candidate of [base, `${base}.ts`, base.replace(/\.js$/, ".ts")]) if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return load(candidate);
      throw new Error(`cannot resolve ${spec}`);
    };
    vm.runInThisContext(`(function (exports, require) {${src}\n})`)(exports, req);
    return exports;
  };
  const require_ = (p: string) => {
    const m = { exports: {} as unknown };
    vm.runInThisContext(`(function (module, exports) {${fs.readFileSync(p, "utf8")}\n})`)(m, m.exports);
    return m.exports;
  };
  const out: string[] = [];
  const mods: Record<string, unknown> = {};
  for (const f of c.files) mods[path.basename(f).replace(/\.lucent\.ts$/, "")] = load(f);
  const first = mods[path.basename(c.files[0]!).replace(/\.lucent\.ts$/, "")];
  const sandbox = {
    print: (...args: unknown[]) => out.push(args.map((a) => String(a)).join(" ")),
    mods,
    mod: first,
    lucentClass: (x: unknown) => x,
    setTimeout,
    Promise,
    JSON,
    Math,
    Object,
    Array,
    Error,
    TypeError,
    RangeError,
    Map,
    Set,
    Uint8Array,
    Date,
    AbortController,
    AbortSignal,
    String,
    Number,
  };
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(c.test, "utf8"), sandbox);
  // Let timers and promises settle.
  for (let i = 0; i < 200; i++) await new Promise((r) => setTimeout(r, 10));
  return out.join("\n") + (out.length ? "\n" : "");
}

async function main() {
  const filter = process.argv.slice(2);
  const lib = runtimeLib();
  let failed = 0;
  for (const c of cases(filter)) {
    const t0 = Date.now();
    try {
      const [native, reference] = [nativeRun(c, lib), await referenceRun(c)];
      if (native !== reference) {
        failed++;
        console.log(`✗ ${c.name}: output differs`);
        const n = native.split("\n"), r = reference.split("\n");
        for (let i = 0; i < Math.max(n.length, r.length); i++) {
          if (n[i] !== r[i]) console.log(`  line ${i + 1}\n    native:    ${n[i]}\n    reference: ${r[i]}`);
        }
      } else {
        console.log(`✓ ${c.name} (${native.split("\n").length - 1} lines, ${Date.now() - t0} ms)`);
      }
    } catch (e) {
      failed++;
      console.log(`✗ ${c.name}: ${(e as Error).message}`);
    }
  }
  if (failed) {
    console.log(`${failed} case(s) failed`);
    process.exit(1);
  }
}

void execFileSync;
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();

export { cases, referenceRun, type Case };
