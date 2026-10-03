/**
 * End-to-end tests: every case is compiled to C++, built into a Hermes host,
 * and run through real JSI. The same test script also runs against the
 * module's TypeScript source executed as plain JavaScript (in Node), and the
 * two outputs must match line for line.
 *
 *   node packages/compiler/test/e2e/run.ts [case-name...]
 *
 * Env: HERMES_DIR (Hermes checkout built into build/), SANITIZE=1, CXX.
 */
import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import ts from "typescript";
import {
  bindExtensions,
  compile,
  coreJsPath,
  type LucentPackage,
  type NativeInputs,
  report,
  resolveNative,
} from "../../src/index.ts";
import { exec, pool } from "../../../runtime/test/parallel.ts";
import { cFlags, hostLibs, runtimeSources } from "../../../runtime/test/sources.ts";

// One time zone with daylight saving time for both runs (the native host
// inherits it), so local-time code is exercised even on UTC machines.
process.env.TZ = process.env.LUCENT_TEST_TZ ?? "America/New_York";

const here = path.dirname(fileURLToPath(import.meta.url));
const casesDir = path.join(here, "cases");
const runtimeDir = path.resolve(here, "../../../runtime");
const coreJs = coreJsPath();
const abortPolyfill = path.resolve(here, "../../../runtime/test/jsi/abort-polyfill.js");
const hermes = process.env.HERMES_DIR ?? path.join(os.homedir(), "hermes");
const sanitize = process.env.SANITIZE === "1";
const cxx = process.env.CXX ?? "clang++";
const work = path.join(os.tmpdir(), `lucent-e2e${sanitize ? "-san" : ""}`);

// Generated code builds with -Werror in the NDK's appmodules build; match it
// (and the podspec/CMake suppressions) so warnings fail here first.
const deviceFlags = cxx.includes("clang")
  ? ["-Werror", "-Wno-gnu-statement-expression", "-Wno-parentheses-equality", "-Wno-comma"]
  : [];

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

/** How many cases, and how many runtime sources, compile at once. */
const jobs = Number(process.env.LUCENT_E2E_JOBS ?? os.availableParallelism());

async function sh(cmd: string, args: string[]): Promise<void> {
  const r = await exec(cmd, args);

  if (r.status !== 0)
    throw new Error(`${cmd} ${args.slice(-3).join(" ")} failed:\n${r.stderr}\n${r.stdout}`);
}

/** Builds the runtime + harness objects once (cached by content hash). */
async function runtimeLib(): Promise<string> {
  const rs = runtimeSources(path.join(runtimeDir, "cpp"));
  const sources = [...rs.cxx, ...rs.c, path.join(runtimeDir, "test/jsi/harness.cpp")];
  const headers = [
    ...fs
      .readdirSync(path.join(runtimeDir, "cpp/lucent"))
      .filter((f) => f.endsWith(".h"))
      .map((f) => path.join(runtimeDir, "cpp/lucent", f)),
    ...fs
      .readdirSync(path.join(runtimeDir, "cpp/lucent/jsi"))
      .filter((f) => f.endsWith(".h"))
      .map((f) => path.join(runtimeDir, "cpp/lucent/jsi", f)),
  ];
  const hash = crypto.createHash("sha1");
  for (const f of [...sources, ...headers]) hash.update(fs.readFileSync(f));
  hash.update(baseFlags.join(" "));
  const dir = path.join(work, "rt", hash.digest("hex").slice(0, 12));
  const lib = path.join(dir, "liblucentrt.a");
  if (fs.existsSync(lib)) return lib;
  fs.mkdirSync(dir, { recursive: true });
  const objs = await Promise.all(
    pool(sources, jobs, async (src) => {
      const obj = path.join(dir, path.basename(src).replace(/\.cpp$/, ".o"));
      if (src.endsWith(".c"))
        await sh(process.env.CC ?? "clang", [
          ...cFlags,
          ...(sanitize ? ["-fsanitize=address,undefined"] : []),
          "-c",
          src,
          "-o",
          obj,
        ]);
      else await sh(cxx, [...baseFlags, "-c", src, "-o", obj]);
      return obj;
    }),
  );
  await sh("ar", ["rcs", lib, ...objs]);
  return lib;
}

interface Case {
  name: string;
  files: string[];
  test: string;
  /** Lucent packages whose native extensions the case imports (extensions.json in its directory). */
  packages?: string[];
}

function cases(filter: string[]): Case[] {
  const out: Case[] = [];
  for (const entry of fs.readdirSync(casesDir, { withFileTypes: true })) {
    if (entry.isFile() && entry.name.endsWith(".test.js")) {
      const name = entry.name.replace(/\.test\.js$/, "");
      const dir = path.join(casesDir, name);
      const files =
        fs.existsSync(dir) && fs.statSync(dir).isDirectory()
          ? fs
              .readdirSync(dir)
              .filter((f) => f.endsWith(".lucent.ts"))
              .map((f) => path.join(dir, f))
          : [path.join(casesDir, `${name}.lucent.ts`)];
      const declared = path.join(dir, "extensions.json");
      const packages = fs.existsSync(declared)
        ? (JSON.parse(fs.readFileSync(declared, "utf8")) as { packages: string[] }).packages.map(
            (p) => path.resolve(dir, p),
          )
        : undefined;
      out.push({
        name,
        files,
        test: path.join(casesDir, entry.name),
        ...(packages ? { packages } : {}),
      });
    }
  }
  return out
    .filter((c) => filter.length === 0 || filter.includes(c.name))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** A case's Lucent packages, and their needs resolved: what a build of an app with them reads. */
function casePackages(c: Case): { native: NativeInputs; packages: LucentPackage[] } | undefined {
  if (!c.packages) return undefined;

  const packages = c.packages.map((dir): LucentPackage => {
    const pkg = JSON.parse(fs.readFileSync(path.join(dir, "package.json"), "utf8")) as {
      name: string;
      version: string;
      lucent: { sources: string };
    };

    return {
      name: pkg.name,
      version: pkg.version,
      dir,
      sources: path.join(dir, pkg.lucent.sources),
    };
  });

  return { native: resolveNative(packages), packages };
}

/** Case `c` compiled and built into a host with its prelude: the command that runs it. */
async function nativeBuild(c: Case, lib: string): Promise<string[]> {
  const found = casePackages(c);
  const extensions = found ? bindExtensions(found.native.extensions) : undefined;
  const result = compile(c.files, { extensions });
  if (!result.ok) throw new Error(`compile errors:\n${report(result.diagnostics)}`);
  const dir = path.join(work, "cases", c.name);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  const objs: string[] = [];

  // The packages' native sources, built as the app's native package builds them: each directory
  // is a header search path of the generated code, and its C and C++ files are compiled in.
  const dirOf = new Map(found?.packages.map((p) => [p.name, p.dir]));
  const sourceDirs = (found?.native.manifest.ios.nativeSources ?? []).map((p) =>
    path.join(dirOf.get(p.package)!, p.path),
  );
  for (const src of sourceDirs.flatMap((d) => fs.readdirSync(d).map((f) => path.join(d, f)))) {
    if (!/\.(c|cc|cpp)$/.test(src)) continue;
    const obj = path.join(dir, `pkg_${path.basename(src)}.o`);
    if (src.endsWith(".c")) await sh(process.env.CC ?? "clang", [...cFlags, "-c", src, "-o", obj]);
    else await sh(cxx, [...baseFlags, "-c", src, "-o", obj]);
    objs.push(obj);
  }
  const includes = sourceDirs.map((d) => `-I${d}`);

  for (const [name, content] of result.files) fs.writeFileSync(path.join(dir, name), content);
  for (const name of result.files.keys()) {
    if (!name.endsWith(".cpp")) continue;
    const obj = path.join(dir, name.replace(/\.cpp$/, ".o"));
    await sh(cxx, [
      ...baseFlags,
      ...deviceFlags,
      `-I${dir}`,
      ...includes,
      "-c",
      path.join(dir, name),
      "-o",
      obj,
    ]);
    objs.push(obj);
  }
  const exe = path.join(dir, "host");
  await sh(cxx, [
    ...baseFlags,
    ...objs,
    lib,
    `-L${path.join(hermes, "build/lib")}`,
    `-L${path.join(hermes, "build/jsi")}`,
    "-lhermesvm",
    "-ljsi",
    "-lpthread",
    ...hostLibs,
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
  return [exe, abortPolyfill, prelude, c.test];
}

/**
 * What a built case prints natively. Hosts run one at a time, after every
 * build: the harness takes 20 ms without a post as the end of a case's
 * work, which a busy machine can stretch past.
 */
async function nativeRun([exe, ...args]: string[]): Promise<string> {
  const r = await exec(exe!, args, {
    timeout: 60000,
    env: { ...process.env, ASAN_OPTIONS: "detect_leaks=0" },
  });
  if (r.status !== 0)
    throw new Error(`native run failed (${r.status ?? r.signal}):\n${r.stderr}\n${r.stdout}`);
  if (r.stderr.trim()) process.stderr.write(r.stderr);
  return r.stdout;
}

/** Where the reference's console writes: the lines of the test running, as the harness does. */
let consoleLines: string[] = [];

/** Lucent's console: each argument as String() gives it (a bigint with its `n`), joined by spaces. */
const lucentConsole = Object.fromEntries(
  ["log", "info", "debug", "warn", "error"].map((level) => [
    level,
    (...args: unknown[]) =>
      consoleLines.push(args.map((a) => (typeof a === "bigint" ? `${a}n` : String(a))).join(" ")),
  ]),
);

/**
 * What case `c` prints as plain JavaScript. With `logs`, what its Lucent
 * code logs too, as the harness prints it; an app's Lab does not see the
 * console (os_log, logcat), so its expectations leave it out.
 */
async function referenceRun(c: Case, { logs = true } = {}): Promise<string> {
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
      if (spec === "lucent:core") return require_(coreJs);
      // A native extension: the case's JavaScript stand-in for it.
      const ext = /^lucent:ext\/([\w-]+)$/.exec(spec)?.[1];
      if (ext) return load(path.join(path.dirname(c.files[0]!), "lucent-ext", `${ext}.ts`));
      const base = path.resolve(path.dirname(key), spec);
      for (const candidate of [base, `${base}.ts`, base.replace(/\.js$/, ".ts")])
        if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return load(candidate);
      throw new Error(`cannot resolve ${spec}`);
    };
    vm.runInThisContext(`(function (exports, require, console) {${src}\n})`, { filename: key })(
      exports,
      req,
      lucentConsole,
    );
    return exports;
  };
  const require_ = (p: string) => {
    const m = { exports: {} as unknown };
    vm.runInThisContext(`(function (module, exports) {${fs.readFileSync(p, "utf8")}\n})`)(
      m,
      m.exports,
    );
    return m.exports;
  };
  const mods: Record<string, unknown> = {};
  for (const f of c.files) mods[path.basename(f).replace(/\.lucent\.ts$/, "")] = load(f);
  // The example apps run a case again (Run again, switching tabs) against the
  // same loaded modules: a case must print the same thing every time.
  const once = await runTest(c, mods, logs);
  const again = await runTest(c, mods, logs);
  if (again !== once) {
    const a = once.split("\n"),
      b = again.split("\n");
    const i = a.findIndex((l, k) => l !== b[k]);
    throw new Error(
      `prints something else when run again with the same modules (line ${i + 1}: ${JSON.stringify(a[i])}, then ${JSON.stringify(b[i])}); report what a run changes, not module state`,
    );
  }
  return once;
}

async function runTest(c: Case, mods: Record<string, unknown>, logs: boolean): Promise<string> {
  const out: string[] = [];
  consoleLines = logs ? out : [];
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
    SyntaxError,
    BigInt,
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
  // Let timers and promises settle: until no timer is pending, for at most 200 turns of 10 ms.
  for (let i = 0; i < 200; i++) {
    await new Promise((r) => setTimeout(r, i ? 10 : 0));

    if (!process.getActiveResourcesInfo().includes("Timeout")) break;
  }
  return out.join("\n") + (out.length ? "\n" : "");
}

async function main() {
  const filter = process.argv.slice(2);
  const lib = await runtimeLib();
  const all = cases(filter);
  // Cases build side by side; then each runs natively and as JavaScript, one at a time (the
  // references share the console and the process's timers).
  const builds = pool(all, jobs, (c) => nativeBuild(c, lib));
  await Promise.allSettled(builds);
  let failed = 0;
  for (const [i, c] of all.entries()) {
    const t0 = Date.now();
    try {
      const [native, reference] = [await nativeRun(await builds[i]!), await referenceRun(c)];
      if (native !== reference) {
        failed++;
        console.log(`✗ ${c.name}: output differs`);
        const n = native.split("\n"),
          r = reference.split("\n");
        for (let i = 0; i < Math.max(n.length, r.length); i++) {
          if (n[i] !== r[i])
            console.log(`  line ${i + 1}\n    native:    ${n[i]}\n    reference: ${r[i]}`);
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
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  await main();

export { casePackages, cases, referenceRun, type Case };
