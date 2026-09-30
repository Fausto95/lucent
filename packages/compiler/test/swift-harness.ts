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

export const xcode = process.platform === "darwin" && sdkAvailable("ios");

const compiledModules = new Map<string, string>();

/** The directory `-I` finds a Swift fixture module in, compiled for the simulator once per process. */
function moduleDir(name: string): string {
  let dir = compiledModules.get(name);
  if (!dir) {
    dir = swiftModule(name);
    compiledModules.set(name, dir);
  }

  return dir;
}

/** Compiles Swift fixture modules ahead of the tests using them (in a beforeAll: it takes a while). */
export function prepareSwiftModules(names: string[]): void {
  for (const name of names) moduleDir(name);
}

export interface IosProgram {
  r: ReturnType<typeof compile>;
  dir: string;
  mm: string;
  shims: string;
  /** The Swift fixture modules it was compiled against. */
  modules: string[];
}

/**
 * A program's iOS output: `src` is the iOS side of a module exporting
 * run(), compiled against the Swift fixture `modules` (none: the SDK alone).
 */
export function iosProgram(src: string, modules: string[] = []): IosProgram {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lucent-swift-"));
  const files = {
    "m.lucent.ts": "export declare function run(): Promise<string>;\n",
    "m.ios.lucent.ts": src,
    "m.android.lucent.ts": 'export async function run(): Promise<string> {\n  return "";\n}\n',
  };
  for (const [name, text] of Object.entries(files)) fs.writeFileSync(path.join(dir, name), text);

  const includePaths = modules.map(moduleDir);
  const r = compile(
    Object.keys(files).map((f) => path.join(dir, f)),
    {
      platforms: ["ios"],
      ...(modules.length
        ? { sdk: { cacheDir: path.join(dir, "cache"), ios: { includePaths } } }
        : {}),
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
          ...p.modules.flatMap((m) => ["-I", moduleDir(m)]),
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
 * The runtime as a static library for the host, built once per change of
 * its sources and shared by test processes (published by rename).
 */
function hostRuntime(): string {
  const cppDir = path.join(runtimeDir(), "cpp");
  const { cxx, c } = runtimeSources(cppDir);
  const own = [...cxx.filter((f) => !f.includes(`${path.sep}jsi${path.sep}`)), ...c];

  const hash = crypto.createHash("sha256");
  for (const f of own) hash.update(f).update(fs.readFileSync(f));
  for (const f of fs.readdirSync(path.join(cppDir, "lucent")))
    if (f.endsWith(".h")) hash.update(fs.readFileSync(path.join(cppDir, "lucent", f)));

  const lib = path.join(os.tmpdir(), `lucent-host-runtime-${hash.digest("hex").slice(0, 16)}.a`);
  if (fs.existsSync(lib)) return lib;

  const work = fs.mkdtempSync(path.join(os.tmpdir(), "lucent-host-runtime-"));
  const objects = own.map((f) => {
    const o = path.join(work, `${path.basename(f)}.o`);
    const flags = f.endsWith(".c")
      ? cFlags
      : ["-std=c++20", "-ffp-contract=off", "-O1", "-g", `-I${cppDir}`];
    run("xcrun", ["clang++", ...(f.endsWith(".c") ? ["-x", "c"] : []), ...flags, "-c", f, "-o", o]);
    return o;
  });

  const tmp = `${lib}.${process.pid}`;
  run("xcrun", ["libtool", "-static", "-o", tmp, ...objects]);
  fs.renameSync(tmp, lib);
  fs.rmSync(work, { recursive: true, force: true });

  return lib;
}

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
    const o = path.join(work, `${m}.o`);
    run("xcrun", [
      "swiftc",
      "-parse-as-library",
      "-module-name",
      m,
      "-emit-module",
      "-emit-module-path",
      path.join(modules, `${m}.swiftmodule`),
      "-emit-object",
      "-o",
      o,
      swiftSource(m),
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
