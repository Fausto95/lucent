/**
 * iOS programs that call Swift, in tests: a module's iOS output against
 * Swift fixture modules, whether its shims and glue compile (Swift
 * -warnings-as-errors, Objective-C++ -Werror), and what it prints when it
 * runs on the macOS host with the runtime.
 */
import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { sdkAvailable } from "@lucent-lang/bindgen";
import { swiftModule, swiftSource } from "../../bindgen/test/swift-module.ts";
import { cFlags, runtimeSources } from "../../runtime/test/sources.ts";
import { compile, runtimeDir } from "../src/index.ts";
import { compileAll } from "./parallel-build.ts";

export const xcode = process.platform === "darwin" && sdkAvailable("ios");

/**
 * A Swift module a program is compiled against: a fixture of bindgen's by
 * its name, or any module's name and source file. A program's modules are
 * listed dependencies first: each sees the ones before it.
 */
export type SwiftFixture = string | { name: string; source: string };

const nameOf = (m: SwiftFixture) => (typeof m === "string" ? m : m.name);

const sourceOf = (m: SwiftFixture) => (typeof m === "string" ? swiftSource(m) : m.source);

const compiledModules = new Map<string, string>();

/**
 * The directory `-I` finds a Swift module in, compiled for the simulator once
 * per process, seeing the modules listed before it in `modules`.
 */
function moduleDir(m: SwiftFixture, modules: SwiftFixture[] = [m]): string {
  const key = `${nameOf(m)}\0${sourceOf(m)}`;
  let dir = compiledModules.get(key);
  if (!dir) {
    const before = modules.slice(0, modules.indexOf(m));
    dir = swiftModule(
      nameOf(m),
      sourceOf(m),
      before.map((d) => moduleDir(d, modules)),
    );
    compiledModules.set(key, dir);
  }

  return dir;
}

/** Compiles Swift fixture modules ahead of the tests using them (in a beforeAll: it takes a while). */
export function prepareSwiftModules(modules: SwiftFixture[]): void {
  for (const m of modules) moduleDir(m, modules);
}

export interface IosProgram {
  r: ReturnType<typeof compile>;
  dir: string;
  mm: string;
  shims: string;
  /** The Swift modules it was compiled against, dependencies first. */
  modules: SwiftFixture[];
}

/**
 * A program's iOS output: `src` is the iOS side of a module exporting
 * run(), compiled against the Swift fixture `modules` (none: the SDK alone).
 */
export function iosProgram(src: string, modules: SwiftFixture[] = []): IosProgram {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lucent-swift-"));
  const files = {
    "m.lucent.ts": "export declare function run(): Promise<string>;\n",
    "m.ios.lucent.ts": src,
    "m.android.lucent.ts": 'export async function run(): Promise<string> {\n  return "";\n}\n',
  };
  for (const [name, text] of Object.entries(files)) fs.writeFileSync(path.join(dir, name), text);

  const includePaths = modules.map((m) => moduleDir(m, modules));
  const r = compile(
    Object.keys(files).map((f) => path.join(dir, f)),
    {
      platforms: ["ios"],
      // The shared SDK cache, as an app's builds use it: the SDK's symbol graphs are extracted
      // once, not for every program, and each fixture module is cached by its content.
      ...(modules.length ? { sdk: { ios: { includePaths } } } : {}),
    },
  );

  return {
    r,
    dir,
    mm: r.files.get("ios/m_m.mm") ?? "",
    shims: r.files.get("ios/LucentShims.swift") ?? "",
    modules,
  };
}

/** Writes a program's files under `<dir>/out`. */
function writeOut({ r, dir }: IosProgram): string {
  const out = path.join(dir, "out");
  for (const [k, v] of r.files) {
    fs.mkdirSync(path.dirname(path.join(out, k)), { recursive: true });
    fs.writeFileSync(path.join(out, k), v);
  }

  return out;
}

/** Warnings the glue is allowed, as the podspec allows them. */
const glueFlags = [
  "-std=c++20",
  "-ffp-contract=off",
  "-fobjc-arc",
  "-Werror",
  "-Wno-gnu-statement-expression",
  "-Wno-unused-label",
  "-Wno-parentheses-equality",
  "-Wno-comma",
];

/**
 * What type-checking the shims (Swift, -warnings-as-errors) and the glue
 * (Objective-C++, -Werror) reports: nothing, when both compile.
 */
export function compileErrors(p: IosProgram) {
  const out = writeOut(p);
  const sdk = spawnSync("xcrun", ["--sdk", "iphonesimulator", "--show-sdk-path"], {
    encoding: "utf8",
  }).stdout.trim();
  const target = "arm64-apple-ios15.1-simulator";

  const shims = path.join(out, "ios/LucentShims.swift");
  const swiftc = fs.existsSync(shims)
    ? spawnSync(
        "xcrun",
        [
          "swiftc",
          "-typecheck",
          "-parse-as-library",
          "-warnings-as-errors",
          // The language mode the pod builds in (s.swift_version).
          "-swift-version",
          "5",
          "-target",
          target,
          "-sdk",
          sdk,
          ...p.modules.flatMap((m) => ["-I", moduleDir(m, p.modules)]),
          shims,
        ],
        { encoding: "utf8" },
      )
    : { stderr: "" };

  const clang = spawnSync(
    "xcrun",
    [
      "--sdk",
      "iphonesimulator",
      "clang++",
      ...glueFlags,
      "-fsyntax-only",
      "-target",
      target,
      `-I${path.join(runtimeDir(), "cpp")}`,
      `-I${path.join(out, "ios")}`,
      "-x",
      "objective-c++",
      path.join(out, "ios/m_m.mm"),
    ],
    { encoding: "utf8" },
  );

  return { diagnostics: p.r.diagnostics, swiftc: swiftc.stderr, clang: clang.stderr };
}

export const compiles = { diagnostics: [], swiftc: "", clang: "" };

/** Calls run() on the Lucent thread and prints what it settles with, one line. */
const hostMain = `#include <atomic>
#include <chrono>
#include <cstdio>
#include <thread>

#include "m_m.h"

int main() {
  std::atomic<bool> done{false};

  lucent::postCallback([&done] {
    lucent_app::m_m::init();

    auto p = lucent_app::m_m::run();
    p.onSettled([p, &done] {
      if (p.fulfilled()) {
        std::printf("%s\\n", p.value().toUtf8().c_str());
      } else {
        std::printf("rejected: %s\\n", lucent::toJsString(p.error()).toUtf8().c_str());
      }

      std::fflush(stdout);
      done = true;
    });
  });

  for (int i = 0; i < 20000 && !done; i++) std::this_thread::sleep_for(std::chrono::milliseconds(1));
  return done ? 0 : 2;
}
`;

const run = (cmd: string, args: string[], cwd?: string) => {
  const r = spawnSync(cmd, args, { encoding: "utf8", cwd, maxBuffer: 1 << 26 });
  if (r.status !== 0) throw new Error(`${cmd} ${args.slice(0, 3).join(" ")}: ${r.stderr}`);
  return r;
};

/**
 * The runtime as a static library for the host, compiled side by side once
 * per change of its sources and shared by test processes (published by
 * rename).
 */
export function hostRuntime(): string {
  const cppDir = path.join(runtimeDir(), "cpp");
  const { cxx, c } = runtimeSources(cppDir);
  const own = [...cxx.filter((f) => !f.includes(`${path.sep}jsi${path.sep}`)), ...c];

  const hash = crypto.createHash("sha256");
  for (const f of own) hash.update(f).update(fs.readFileSync(f));
  for (const f of fs.readdirSync(path.join(cppDir, "lucent")))
    if (f.endsWith(".h")) hash.update(fs.readFileSync(path.join(cppDir, "lucent", f)));

  const lib = path.join(os.tmpdir(), `lucent-host-runtime-${hash.digest("hex").slice(0, 16)}.a`);
  if (fs.existsSync(lib)) return lib;

  // One process builds it; the others wait for it rather than build it too.
  const lock = `${lib}.lock`;
  try {
    fs.mkdirSync(lock);
  } catch {
    for (let waited = 0; !fs.existsSync(lib) && waited < 600_000; waited += 100) sleep(100);
    if (fs.existsSync(lib)) return lib;
  }

  const work = fs.mkdtempSync(path.join(os.tmpdir(), "lucent-host-runtime-"));
  const jobs = own.map((f) => ({
    cmd: "xcrun",
    args: [
      "clang++",
      ...(f.endsWith(".c")
        ? ["-x", "c", ...cFlags]
        : ["-std=c++20", "-ffp-contract=off", "-O1", "-g", `-I${cppDir}`]),
      "-c",
      f,
    ],
    object: path.join(work, `${path.basename(f)}.o`),
  }));
  const printed = compileAll(jobs);
  const missing = jobs.filter((j) => !fs.existsSync(j.object));

  if (missing.length) throw new Error(`the host runtime did not compile:\n${printed}`);

  const tmp = `${lib}.${process.pid}`;
  run("xcrun", ["libtool", "-static", "-o", tmp, ...jobs.map((j) => j.object)]);
  fs.renameSync(tmp, lib);
  fs.rmSync(work, { recursive: true, force: true });
  fs.rmSync(lock, { recursive: true, force: true });

  return lib;
}

const sleep = (ms: number) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

/**
 * Builds a program for the macOS host (its Swift fixture modules, shims,
 * glue and the runtime) and runs it: what run() settled with.
 */
export function hostRun(p: IosProgram): { status: number | null; stdout: string; stderr: string } {
  const out = writeOut(p);
  const work = path.join(p.dir, "host");
  const modules = path.join(work, "modules");
  fs.mkdirSync(modules, { recursive: true });

  const objects: string[] = [];
  for (const m of p.modules) {
    const o = path.join(work, `${nameOf(m)}.o`);
    run("xcrun", [
      "swiftc",
      "-parse-as-library",
      "-module-name",
      nameOf(m),
      // The modules before it, which it may import.
      "-I",
      modules,
      "-emit-module",
      "-emit-module-path",
      path.join(modules, `${nameOf(m)}.swiftmodule`),
      "-emit-object",
      "-o",
      o,
      sourceOf(m),
    ]);
    objects.push(o);
  }

  const shims = path.join(out, "ios/LucentShims.swift");
  if (fs.existsSync(shims)) {
    const o = path.join(work, "shims.o");
    run("xcrun", [
      "swiftc",
      "-parse-as-library",
      "-module-name",
      "LucentShims",
      "-I",
      modules,
      "-emit-object",
      "-o",
      o,
      shims,
    ]);
    objects.push(o);
  }

  const main = path.join(work, "main.mm");
  fs.writeFileSync(main, hostMain);
  for (const [src, o] of [
    [path.join(out, "ios/m_m.mm"), path.join(work, "glue.o")],
    [main, path.join(work, "main.o")],
  ] as const) {
    run("xcrun", [
      "clang++",
      ...glueFlags,
      "-g",
      `-I${path.join(runtimeDir(), "cpp")}`,
      `-I${path.join(out, "ios")}`,
      "-x",
      "objective-c++",
      "-c",
      src,
      "-o",
      o,
    ]);
    objects.push(o);
  }

  const bin = path.join(work, "program");
  run("xcrun", [
    "swiftc",
    ...objects,
    hostRuntime(),
    "-o",
    bin,
    "-lc++",
    "-framework",
    "Foundation",
    "-framework",
    "CoreFoundation",
  ]);

  const r = spawnSync(bin, [], { encoding: "utf8", timeout: 60_000 });
  return { status: r.status, stdout: r.stdout, stderr: r.stderr };
}
