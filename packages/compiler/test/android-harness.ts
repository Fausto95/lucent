/**
 * Compiling Android platform code in tests: a module's Android glue, and
 * checking it with the NDK when one is installed.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { classpathFile } from "../../bindgen/test/java-fixtures.ts";
import { runJar } from "../../bindgen/test/jvm-tools.ts";
import {
  compileKotlin,
  kotlinFixtures,
  kotlinSources,
  type KotlinToolchain,
} from "../../bindgen/test/kotlin-toolchain.ts";
import { compile, runtimeDir, type SdkOptions } from "../src/index.ts";
import { type Job, runAll } from "./parallel-build.ts";

/** Android output for a platform module whose Android side is `src` (exporting run()). */
export function android(src: string, sdk?: SdkOptions) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lucent-android-"));
  const files = {
    "m.lucent.ts": "export declare function run(): Promise<string>;\n",
    "m.ios.lucent.ts": 'export async function run(): Promise<string> {\n  return "";\n}\n',
    "m.android.lucent.ts": src,
  };
  for (const [name, text] of Object.entries(files)) fs.writeFileSync(path.join(dir, name), text);
  const r = compile(
    Object.keys(files).map((f) => path.join(dir, f)),
    { platforms: ["android"], sdk },
  );
  return { r, cpp: r.files.get("android/m_m.cpp") ?? "", dir };
}

/** The NDK's clang++, when an NDK is installed. */
export function ndkClang(): string | undefined {
  const ndkRoot = path.join(
    process.env.ANDROID_HOME ?? path.join(os.homedir(), "Library/Android/sdk"),
    "ndk",
  );
  const ndk = fs.existsSync(ndkRoot) ? fs.readdirSync(ndkRoot).sort().pop() : undefined;
  if (!ndk) return undefined;

  return fs
    .readdirSync(path.join(ndkRoot, ndk, "toolchains/llvm/prebuilt"))
    .map((h) => path.join(ndkRoot, ndk, "toolchains/llvm/prebuilt", h, "bin/clang++"))[0]!;
}

/** The NDK check of a compile's Android glue (written into `dir`), warnings as errors. */
function ndkJob(bin: string, files: ReadonlyMap<string, string>, dir: string): Job {
  for (const [k, v] of files) {
    fs.mkdirSync(path.dirname(path.join(dir, "out", k)), { recursive: true });
    fs.writeFileSync(path.join(dir, "out", k), v);
  }

  return {
    cmd: bin,
    args: [
      "--target=aarch64-linux-android24",
      "-std=c++20",
      "-fsyntax-only",
      "-Werror",
      "-Wno-gnu-statement-expression",
      "-Wno-unused-label",
      "-Wno-parentheses-equality",
      "-Wno-comma",
      `-I${path.join(runtimeDir(), "cpp")}`,
      `-I${path.join(dir, "out/android")}`,
      path.join(dir, "out/android/m_m.cpp"),
    ],
  };
}

/** What the NDK says of a compile's Android glue, warnings as errors: nothing when it compiles. */
export function ndkErrors(bin: string, files: ReadonlyMap<string, string>, dir: string): string {
  return ndkErrorsAll(bin, [{ files, dir }])[0]!;
}

/** What the NDK says of each compile's Android glue, checked side by side. */
export function ndkErrorsAll(
  bin: string,
  units: { files: ReadonlyMap<string, string>; dir: string }[],
): string[] {
  return runAll(units.map((u) => ndkJob(bin, u.files, u.dir))).map((r) => r.output);
}

/**
 * An app's classpath holding bindgen's Kotlin fixture library and the Kotlin standard library.
 * With `annotations` (an annotations.xml for dev.orbit.search), the library is an AAR whose
 * annotations.zip carries them, as an Android library ships its @RequiresPermission.
 */
export async function kotlinClasspath(
  kotlin: KotlinToolchain,
  options: { annotations?: string } = {},
): Promise<SdkOptions> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lucent-kotlin-classpath-"));
  const jar = await compileKotlin(
    kotlin,
    kotlinSources(kotlinFixtures),
    path.join(dir, "orbit-search.jar"),
  );
  const stdlib = path.join(kotlin.lib, "kotlin-stdlib.jar");
  const classpath = path.join(dir, "android-classpath.json");

  if (!options.annotations) return { android: { classpath: classpathFile(classpath, [stdlib, jar]) } };

  const aar = path.join(dir, "aar");
  fs.mkdirSync(aar);
  fs.copyFileSync(jar, path.join(aar, "classes.jar"));
  const xml = path.join(dir, "ann/dev/orbit/search");
  fs.mkdirSync(xml, { recursive: true });
  fs.writeFileSync(path.join(xml, "annotations.xml"), options.annotations);
  jarOrThrow(["cfM", path.join(aar, "annotations.zip"), "-C", path.join(dir, "ann"), "."]);
  const file = path.join(dir, "orbit-search.aar");
  jarOrThrow(["cfM", file, "-C", aar, "."]);

  return { android: { classpath: classpathFile(classpath, [stdlib], [file]) } };
}

function jarOrThrow(args: string[]): void {
  const r = runJar(args);
  if (r.status !== 0) throw new Error(r.stderr);
}
