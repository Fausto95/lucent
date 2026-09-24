import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { forgetLoadedSdks, type NativeDependencies, podsSearchPaths, runtimeDir, type SdkOptions, withGradleDependencies } from "@lucent-lang/compiler";
import { withLucentPaths } from "./tsconfig.ts";

/** Something a command did to the project, or asks the user to do. */
export type Notice = { level: "ok" | "warn"; text: string };

/** Points `lucent:*` in the app's tsconfig.json at the declarations lucent build writes, for editors and tsc. */
export function mapLucentPaths(root: string): Notice | undefined {
  const file = path.join(root, "tsconfig.json");
  if (!fs.existsSync(file)) return undefined;
  let text: string | undefined;
  try {
    text = withLucentPaths(fs.readFileSync(file, "utf8"));
  } catch (e) {
    return { level: "warn", text: `${(e as Error).message}; add "paths": { "lucent:*": ["./.lucent/native/types/*"] } to its compilerOptions yourself` };
  }
  if (text === undefined) return undefined;
  fs.writeFileSync(file, text);
  return { level: "ok", text: "mapped lucent:* in tsconfig.json" };
}

/** Where this project's bindings come from: the SDKs, and what the app links. */
export function projectSdk(root: string): SdkOptions {
  const pods = podsSearchPaths(path.join(root, "ios"));
  return { android: { classpath: path.join(root, ".lucent/android-classpath.json") }, ...(pods ? { ios: pods } : {}) };
}

/**
 * An Android import that android.jar does not have is looked up in the app's
 * dependencies: resolve them with Gradle (the lucentClasspath task, from an
 * init script, so the app's build files stay as they are) once per change of
 * what decides the classpath. The inputs' hash is recorded with the outcome,
 * a failure included, so neither builds nor watch rebuilds rerun Gradle for
 * the same inputs.
 */
export function resolveAndroidDependencies(root: string, files: string[], sdk: SdkOptions, native: NativeDependencies, force: boolean): AndroidDependencies {
  const android = path.join(root, "android");
  const gradlew = path.join(android, process.platform === "win32" ? "gradlew.bat" : "gradlew");
  if (!sdkImports(files).android.length || !fs.existsSync(gradlew)) return { status: "none" };
  const stateFile = path.join(root, ".lucent/android-classpath.state.json");
  const inputs = gradleInputsHash(root, native);
  const state = fs.existsSync(stateFile) ? (JSON.parse(fs.readFileSync(stateFile, "utf8")) as { inputs?: string; ok?: boolean }) : {};
  if (!force && state.inputs === inputs && state.ok === false) {
    return { status: "failed", detail: "Gradle could not resolve them for these build files before; lucent build --force retries" };
  }
  if (!force && state.inputs === inputs && fs.existsSync(sdk.android!.classpath!)) return { status: "cached" };
  const script = path.join(runtimeDir(), "gradle/lucent-classpath.init.gradle");
  const r = spawnSync(gradlew, ["-q", "--init-script", script, ":app:lucentClasspath"], { cwd: android, encoding: "utf8" });
  fs.mkdirSync(path.dirname(stateFile), { recursive: true });
  fs.writeFileSync(stateFile, JSON.stringify({ inputs, ok: r.status === 0 }) + "\n");
  forgetLoadedSdks();
  if (r.status === 0) return { status: "resolved" };
  return { status: "failed", detail: `Gradle could not resolve them (retried when the build files or the lockfile change, or with lucent build --force):\n${(r.stderr || r.stdout).trim().split("\n").slice(-8).join("\n")}` };
}

/** What resolving the app's Android dependencies did: nothing to resolve, nothing changed, resolved, or failed (why). */
export type AndroidDependencies = { status: "none" | "cached" | "resolved" } | { status: "failed"; detail: string };

/** The native package's build.gradle with the Lucent packages' Gradle artifacts, before the rest is written. */
export function writeGradleDependencies(out: string, native: NativeDependencies): void {
  const file = path.join(out, "android/build.gradle");
  const text = withGradleDependencies(fs.readFileSync(path.join(runtimeDir(), "native/android/build.gradle"), "utf8"), native);
  if (fs.existsSync(file) && fs.readFileSync(file, "utf8") === text) return;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
}

/** Info.plist keys Lucent packages need that the app's Info.plist lacks: named, since the app's files are its own. */
export function missingInfoPlistKeys(root: string, native: NativeDependencies): Notice[] {
  const keys = Object.entries(native.infoPlist);
  const out: Notice[] = [];
  if (!keys.length) return out;
  const ios = path.join(root, "ios");
  const plists = fs.existsSync(ios) ? fs.readdirSync(ios).map((d) => path.join(ios, d, "Info.plist")).filter((f) => fs.existsSync(f)) : [];
  for (const plist of plists) {
    const text = fs.readFileSync(plist, "utf8");
    for (const [key, { from }] of keys) {
      if (!text.includes(`<key>${key}</key>`)) out.push({ level: "warn", text: `${from} needs ${key} in ${path.relative(root, plist)} (the Expo config plugin adds it)` });
    }
  }
  return out;
}

/** What decides the app's Android classpath: Gradle's files, and the JS lockfile (autolinked packages). */
function gradleInputsHash(root: string, native: NativeDependencies): string {
  const android = path.join(root, "android");
  const gradle = ["settings.gradle", "settings.gradle.kts", "build.gradle", "build.gradle.kts", "app/build.gradle", "app/build.gradle.kts", "gradle.properties", "gradle/libs.versions.toml"].map((f) => path.join(android, f));
  const h = createHash("sha256");
  for (const f of [...gradle, ...lockfiles(root)]) h.update(`${f}\0${fs.existsSync(f) ? fs.readFileSync(f) : ""}\0`);
  h.update(JSON.stringify(native.gradle));
  return h.digest("hex").slice(0, 16);
}

/** The JS lockfile, in the app or up to the workspace root (monorepos). */
function lockfiles(root: string): string[] {
  const names = ["package-lock.json", "yarn.lock", "pnpm-lock.yaml", "bun.lock", "bun.lockb"];
  for (let dir = path.resolve(root); ; dir = path.dirname(dir)) {
    const found = names.map((n) => path.join(dir, n)).filter((f) => fs.existsSync(f));
    if (found.length || path.dirname(dir) === dir) return found;
  }
}

/** `lucent:<platform>/<module>` imports of the project's files. */
export function sdkImports(files: string[]): { ios: string[]; android: string[] } {
  const out = { ios: new Set<string>(), android: new Set<string>() };
  for (const f of files) for (const m of fs.readFileSync(f, "utf8").matchAll(/["']lucent:(ios|android)\/([\w.]+)["']/g)) out[m[1] as "ios" | "android"].add(m[2]!);
  return { ios: [...out.ios].sort(), android: [...out.android].sort() };
}

/**
 * Extracts each imported module in its own background process: the build
 * then waits on their locks instead of extracting them one after another.
 */
export function backgroundPrefetch(root: string, files: string[]): void {
  const imports = sdkImports(files);
  for (const p of ["ios", "android"] as const) {
    for (const m of imports[p]) {
      const child = spawn(process.execPath, [process.argv[1]!, "sdk", "prefetch", `--${p}`, m, "--root", root], { detached: true, stdio: "ignore" });
      child.unref();
    }
  }
}
