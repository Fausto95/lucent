/**
 * Android programs run on a desktop JVM, in tests: the desktop JNI host.
 * A program's Android glue, Lucent's JNI runtime (android.cpp with
 * LUCENT_JNI_HOST) and the host runtime are linked into an executable that
 * starts a JVM on the app's classpath and calls run(). The Android OS is
 * not there: the main thread is the host runtime's, and android.os.Build
 * and android.util.Log, which Lucent's Java classes read, are stand-ins
 * (jni-host/java). Views need Android itself; their glue is compile-checked.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { runJavac, runKotlinc } from "../../bindgen/test/jvm-tools.ts";
import type { KotlinToolchain } from "../../bindgen/test/kotlin-toolchain.ts";
import { type CompileResult, runtimeDir } from "../src/index.ts";
import { compileAll } from "./parallel-build.ts";
import { hostRuntime } from "./swift-harness.ts";

const host = path.join(import.meta.dirname, "jni-host");

const darwin = process.platform === "darwin";

/** The JDK whose jni.h the glue compiles against and whose libjvm it starts (macOS or Linux). */
export const jdk = (() => {
  if (process.platform !== "darwin" && process.platform !== "linux") return undefined;

  // Linux: the JDK javac belongs to (/usr/lib/jvm/…/bin/javac).
  const javac = () => {
    const found = spawnSync("sh", ["-c", "readlink -f \"$(command -v javac)\""], {
      encoding: "utf8",
    }).stdout?.trim();
    return found ? path.dirname(path.dirname(found)) : undefined;
  };
  const home =
    process.env.JAVA_HOME ??
    (darwin
      ? spawnSync("/usr/libexec/java_home", { encoding: "utf8" }).stdout?.trim()
      : javac());
  const lib = home && path.join(home, "lib/server");
  const jvm = darwin ? "libjvm.dylib" : "libjvm.so";

  return lib && fs.existsSync(path.join(lib, jvm)) ? { home, lib } : undefined;
})();

/** The host's clang++ (`xcrun clang++` on macOS): the command and its first arguments. */
const clang: [string, string[]] = darwin ? ["xcrun", ["clang++"]] : ["clang++", []];

/** Lucent's Java classes the glue loads, beside the Android stand-ins they read. */
function runtimeClasses(dir: string): string {
  const out = path.join(dir, "runtime-classes");
  const java = (d: string) =>
    fs
      .readdirSync(d, { recursive: true, encoding: "utf8" })
      .filter((f) => f.endsWith(".java"))
      .map((f) => path.join(d, f));

  const r = runJavac([
    "--release",
    "11",
    "-d",
    out,
    ...java(path.join(host, "java")),
    path.join(runtimeDir(), "native/android/src/main/java/dev/lucent/NativeProxy.java"),
  ]);
  if (r.status !== 0) throw new Error(`javac: ${r.stderr}`);

  return out;
}

/** Calls run() on the Lucent thread, the JVM started first, and prints what it settles with. */
const main = `#include <atomic>
#include <chrono>
#include <cstdio>
#include <thread>

#include "jni_host.h"
#include "m_m.h"

int main(int, char** argv) {
  lucentStartJvm(argv[1]);
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

/** Writes a compile's files under `<dir>/out`. */
function writeOut(r: CompileResult, dir: string): string {
  const out = path.join(dir, "out");
  for (const [f, text] of r.files) {
    fs.mkdirSync(path.dirname(path.join(out, f)), { recursive: true });
    fs.writeFileSync(path.join(out, f), text);
  }

  return out;
}

/** How the host compiles Android glue (in `out`): as the Android build does, against the JDK's jni.h. */
function glueFlags(out: string): string[] {
  return [
    "-std=c++20",
    "-ffp-contract=off",
    "-O1",
    "-g",
    "-Werror",
    "-Wno-gnu-statement-expression",
    "-Wno-unused-label",
    "-Wno-parentheses-equality",
    "-Wno-comma",
    `-I${path.join(runtimeDir(), "cpp")}`,
    // React Native's Yoga, which a Flex's runtime (lucent/layout.h) includes.
    `-I${path.join(import.meta.dirname, "../../../apps/bare-example/node_modules/react-native/ReactCommon/yoga")}`,
    `-I${host}`,
    `-I${path.join(out, "android")}`,
    `-I${path.join(jdk!.home, "include")}`,
    `-I${path.join(jdk!.home, darwin ? "include/darwin" : "include/linux")}`,
  ];
}

/** What the host's clang says of the runtime's Android `source` (desktop JNI host build): nothing when it compiles. */
export function runtimeAndroidErrors(dir: string, source: string): string {
  const check = spawnSync(
    clang[0],
    [
      ...clang[1],
      ...glueFlags(dir),
      "-DLUCENT_JNI_HOST",
      "-fsyntax-only",
      path.join(runtimeDir(), source),
    ],
    { encoding: "utf8" },
  );

  return check.stderr;
}

/** What the host's clang says of a compile's Android glue `file` (`android/m_m.cpp`): nothing when it compiles. */
export function glueErrors(r: CompileResult, dir: string, file: string): string {
  const out = writeOut(r, dir);
  const check = spawnSync(
    clang[0],
    [...clang[1], ...glueFlags(out), "-fsyntax-only", path.join(out, file)],
    { encoding: "utf8" },
  );

  return check.stderr;
}

/**
 * Builds a program's Android output (written by `compile` into `dir`) for
 * the desktop JNI host and runs it on `classpath` (the app's jars): what
 * run() settled with.
 */
export function jvmRun(
  r: CompileResult,
  dir: string,
  classpath: string[],
  tc?: KotlinToolchain,
): { status: number | null; stdout: string; stderr: string } {
  const out = writeOut(r, dir);

  // The program's Kotlin shims, against the app's classpath.
  const jars = [...classpath, runtimeClasses(dir)];
  const shims = [...(r.kotlin ?? [])].map(([f, text]) => {
    const file = path.join(out, "kotlin", f);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, text);
    return file;
  });
  if (shims.length) {
    if (!tc) throw new Error("the program has Kotlin shims: kotlinc is needed");
    const jar = path.join(dir, "shims.jar");
    const k = runKotlinc(tc, [
      "-jvm-target",
      "11",
      "-Werror",
      "-cp",
      jars.join(":"),
      ...shims,
      "-d",
      jar,
    ]);
    if (k.status !== 0) throw new Error(`kotlinc: ${k.stderr}`);
    jars.push(jar);
  }

  fs.writeFileSync(path.join(out, "android/main.cpp"), main);

  const flags = glueFlags(out);
  const jobs = [
    {
      source: path.join(runtimeDir(), "cpp/lucent/platform/android.cpp"),
      extra: ["-DLUCENT_JNI_HOST"],
    },
    { source: path.join(host, "jni_host.cpp"), extra: [] },
    { source: path.join(out, "android/m_m.cpp"), extra: [] },
    { source: path.join(out, "android/main.cpp"), extra: [] },
  ].map(({ source, extra }) => ({
    cmd: clang[0],
    args: [...clang[1], ...flags, ...extra, "-c", source],
    object: path.join(dir, `${path.basename(source)}.o`),
  }));

  const printed = compileAll(jobs);
  if (jobs.some((j) => !fs.existsSync(j.object)))
    return { status: null, stdout: "", stderr: printed };

  const exe = path.join(dir, "run");
  const link = spawnSync(
    clang[0],
    [
      ...clang[1],
      ...jobs.map((j) => j.object),
      hostRuntime(),
      `-L${jdk!.lib}`,
      "-ljvm",
      `-Wl,-rpath,${jdk!.lib}`,
      // The host runtime's localeCompare.
      ...(darwin ? ["-framework", "CoreFoundation"] : ["-lpthread"]),
      "-o",
      exe,
    ],
    { encoding: "utf8" },
  );
  if (link.status !== 0) return { status: null, stdout: "", stderr: link.stderr };

  const run = spawnSync(exe, [jars.join(":")], { encoding: "utf8", timeout: 60_000 });
  // The JVM's notice of JAVA_TOOL_OPTIONS (a proxy's settings, on some machines) is not the program's.
  const stderr = run.stderr.replace(/^Picked up JAVA_TOOL_OPTIONS: .*\n/m, "");
  return { status: run.status, stdout: run.stdout, stderr };
}
