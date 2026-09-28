/**
 * The Kotlin toolchain the Kotlin metadata tests and benchmark need, found on
 * this machine: kotlinc with its lib directory (kotlin-metadata-jvm.jar and
 * kotlin-stdlib.jar), java and javac. The JVM reader
 * (packages/bindgen/kotlin-helper) is compiled from source here, as the
 * fixtures are; neither build output is committed.
 */
import { execFile, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import type { KotlinMetadataBatch } from "../src/kotlin-metadata.ts";

export interface KotlinToolchain {
  kotlinc: string;
  /** kotlinc's version: `2.4.20`. */
  version: string;
  /** Holds kotlin-metadata-jvm.jar and kotlin-stdlib.jar. */
  lib: string;
  java: string;
  javac: string;
}

const run = promisify(execFile);

const bindgen = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

export const kotlinFixtures = path.join(bindgen, "test/fixtures/kotlin");

export const versionFixtures = path.join(bindgen, "test/fixtures/kotlin-versions");

const helperSources = path.join(bindgen, "kotlin-helper/src");

/** The Kotlin compiler, its libraries, and a JDK; undefined when any is missing. */
export function kotlinToolchain(): KotlinToolchain | undefined {
  const javaHome = process.env.JAVA_HOME;
  const java = javaHome ? path.join(javaHome, "bin/java") : "java";
  const javac = javaHome ? path.join(javaHome, "bin/javac") : "javac";
  if (spawnSync(java, ["-version"]).status !== 0 || spawnSync(javac, ["-version"]).status !== 0) {
    return undefined;
  }

  const found = spawnSync("sh", ["-c", "command -v kotlinc"], { encoding: "utf8" });
  if (found.status !== 0) return undefined;

  // KOTLIN_HOME/lib, or the lib beside the real kotlinc (Homebrew keeps it in libexec).
  const bin = path.dirname(fs.realpathSync(found.stdout.trim()));
  const lib = [
    process.env.KOTLIN_HOME && path.join(process.env.KOTLIN_HOME, "lib"),
    path.join(bin, "../lib"),
    path.join(bin, "../libexec/lib"),
  ].find((dir) => dir && fs.existsSync(path.join(dir, "kotlin-metadata-jvm.jar")));
  if (!lib || !fs.existsSync(path.join(lib, "kotlin-stdlib.jar"))) return undefined;

  const reported = spawnSync("kotlinc", ["-version"], { encoding: "utf8" });
  const version = /kotlinc-jvm (\S+)/.exec(`${reported.stdout}${reported.stderr}`)?.[1];
  if (!version) return undefined;

  return { kotlinc: "kotlinc", version, lib, java, javac };
}

/** Compiles Kotlin sources into a jar; `env` reaches the compiler's JVM (JAVA_OPTS). */
export async function compileKotlin(
  tc: KotlinToolchain,
  sources: string[],
  jar: string,
  options: { classpath?: string; env?: NodeJS.ProcessEnv } = {},
): Promise<string> {
  const classpath = options.classpath ? ["-cp", options.classpath] : [];

  await run(tc.kotlinc, ["-jvm-target", "11", "-nowarn", ...classpath, ...sources, "-d", jar], {
    env: { ...process.env, ...options.env },
    maxBuffer: 1 << 26,
  });

  return jar;
}

/** Compiles Java sources that use `@kotlin.Metadata` into a class directory. */
export async function compileJava(
  tc: KotlinToolchain,
  sources: string[],
  dir: string,
): Promise<string> {
  const stdlib = path.join(tc.lib, "kotlin-stdlib.jar");
  await run(tc.javac, ["--release", "11", "-cp", stdlib, "-d", dir, ...sources]);
  return dir;
}

export function kotlinSources(dir: string): string[] {
  return fs
    .readdirSync(dir, { recursive: true, encoding: "utf8" })
    .filter((f) => f.endsWith(".kt"))
    .sort()
    .map((f) => path.join(dir, f));
}

/** Builds the JVM reader: its sources against kotlin-metadata-jvm. */
export function buildHelper(tc: KotlinToolchain, jar: string): Promise<string> {
  return compileKotlin(tc, kotlinSources(helperSources), jar, {
    classpath: path.join(tc.lib, "kotlin-metadata-jvm.jar"),
  });
}

/** What the JVM reader needs at run time, beside a JDK. */
export function helperClasspath(tc: KotlinToolchain, helperJar: string): string[] {
  return [
    helperJar,
    path.join(tc.lib, "kotlin-metadata-jvm.jar"),
    path.join(tc.lib, "kotlin-stdlib.jar"),
  ];
}

/** Runs the JVM reader over a batch, in one process; throws with its error message. */
export function readWithHelper(
  tc: KotlinToolchain,
  helperJar: string,
  inputs: string[],
): KotlinMetadataBatch {
  const result = spawnSync(
    tc.java,
    [
      "-cp",
      helperClasspath(tc, helperJar).join(path.delimiter),
      "lucent.kotlinmetadata.Main",
      ...inputs,
    ],
    { encoding: "utf8", maxBuffer: 1 << 30 },
  );

  if (result.status !== 0)
    throw new Error(result.stderr.trim() || `java exited with ${result.status}`);
  return JSON.parse(result.stdout) as KotlinMetadataBatch;
}
