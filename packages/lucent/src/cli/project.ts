import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { frameworkSearchPath, lockedPods, swiftPackages, xcodeApp } from "@lucent-lang/bindgen";
import {
  closesPodspec,
  fileHashes,
  forgetLoadedSdks,
  libraryBuildGradle,
  lucentPackages,
  type NativeInputs,
  packagePods,
  type Platform,
  type PlistValue,
  podsSearchPaths,
  resolveNative,
  type ResolvedNative,
  runtimeDir,
  type SdkOptions,
  sdkModules,
  withPodDependencies,
  writeWhole,
} from "@lucent-lang/compiler";
import { linkNativePackage } from "./init/patch.ts";
import { withLucentPaths } from "./tsconfig.ts";
import { packageFile } from "./version.ts";

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
    return {
      level: "warn",
      text: `${(e as Error).message}; add "paths": { "lucent:*": ["./.lucent/native/types/*"] } to its compilerOptions yourself`,
    };
  }
  if (text === undefined) return undefined;
  fs.writeFileSync(file, text);
  return { level: "ok", text: "mapped lucent:* in tsconfig.json" };
}

/**
 * Where this project's bindings come from: the SDKs, and what the app
 * links: its pods, Swift packages and Gradle classpath, and the prebuilt
 * frameworks and libraries its Lucent packages ship (`native`, resolved
 * here when not given); and the iOS version it is deployed to.
 */
export function projectSdk(root: string, native?: NativeInputs): SdkOptions {
  const binaries = native?.binaries ?? packageBinaries(root);
  const pods = podsSearchPaths(path.join(root, "ios"));

  // The app's Xcode project: the iOS version it is deployed to, and its Swift packages, built.
  const app = xcodeApp(path.join(root, "ios"));
  const project = app
    ? {
        ...(app.deploymentTarget ? { deploymentTarget: app.deploymentTarget } : {}),
        ...(app.packages.length ? { swiftPackages: swiftPackages(app) } : {}),
      }
    : {};

  const frameworkPaths = [
    ...new Set(
      binaries.ios.map(frameworkSearchPath).filter((dir): dir is string => dir !== undefined),
    ),
  ];
  const ios: NonNullable<SdkOptions["ios"]> | undefined =
    pods || frameworkPaths.length || app ? { ...pods, ...project } : undefined;

  return {
    android: {
      classpath: path.join(root, ".lucent/android-classpath.json"),
      ...(binaries.android.length ? { libraries: binaries.android } : {}),
    },
    ...(ios
      ? { ios: { ...ios, frameworkPaths: [...(ios.frameworkPaths ?? []), ...frameworkPaths] } }
      : {}),
  };
}

/**
 * The binaries the project's Lucent packages ship, for commands that bind
 * without building (lucent sdk …): none when a lucent.json is invalid,
 * which the build reports.
 */
function packageBinaries(root: string): NativeInputs["binaries"] {
  const hashes = projectHashes(root);

  try {
    const { binaries } = resolveNative(lucentPackages(root), { hashes });
    hashes.save();
    return binaries;
  } catch {
    return { ios: [], android: [] };
  }
}

/** The project's memo of its packages' file hashes, by their stats. */
export const projectHashes = (root: string) =>
  fileHashes(path.join(root, ".lucent/file-hashes.json"));

/**
 * An Android import that android.jar does not have is looked up in the app's
 * dependencies: resolve them with Gradle (the lucentClasspath task, from an
 * init script, so the app's build files stay as they are) once per change of
 * what decides the classpath. The inputs' hash is recorded with the outcome,
 * a failure included, so neither builds nor watch rebuilds rerun Gradle for
 * the same inputs.
 */
export function resolveAndroidDependencies(
  root: string,
  files: string[],
  sdk: SdkOptions,
  native: ResolvedNative,
  force: boolean,
): AndroidDependencies {
  const gradlew = gradlewOf(root);
  const android = path.dirname(gradlew);

  if (!sdkImports(files).android.length || !fs.existsSync(gradlew)) return { status: "none" };

  const stateFile = path.join(root, ".lucent/android-classpath.state.json");
  const inputs = gradleInputsHash(root, native);
  const record = (ok: boolean) => {
    fs.mkdirSync(path.dirname(stateFile), { recursive: true });
    fs.writeFileSync(stateFile, JSON.stringify({ inputs, ok }) + "\n");
  };

  // The app's lucentBuild task (or a Gradle run lucent build launched) runs this build after
  // resolving the classpath in the same Gradle build: record it, so later builds reuse it.
  if (process.env.LUCENT_GRADLE_CLASSPATH) {
    if (fs.existsSync(sdk.android!.classpath!)) record(true);
    return { status: "cached" };
  }

  // expo prebuild: android/ is being written, and a Gradle run now would cache it half-made
  // (autolinking with the template's package). The Gradle build resolves it later, in lucentBuild.
  if (process.env.LUCENT_NO_GRADLE)
    return fs.existsSync(sdk.android!.classpath!) ? { status: "cached" } : { status: "deferred" };

  const known = (): AndroidDependencies | undefined => {
    const state = fs.existsSync(stateFile)
      ? (JSON.parse(fs.readFileSync(stateFile, "utf8")) as { inputs?: string; ok?: boolean })
      : {};

    if (force || state.inputs !== inputs) return undefined;

    if (state.ok === false)
      return {
        status: "failed",
        detail:
          "Gradle could not resolve them for these build files before; lucent build --force retries",
      };

    return fs.existsSync(sdk.android!.classpath!) ? { status: "cached" } : undefined;
  };

  const before = known();
  if (before) return before;

  // One Gradle run at a time (lucent dev, Metro's watcher and a build in a terminal may overlap):
  // a build that waited uses what the other run resolved, when it was for the same inputs.
  const lock = path.join(root, ".lucent/gradle.lock");
  if (!acquire(lock)) {
    waitFor(lock);

    const after = known();
    if (after) return after;

    if (!acquire(lock)) throw new Error(`${lock}: another lucent build holds it`);
  }

  try {
    const script = packageFile("gradle/lucent-classpath.init.gradle");
    // Any lucent build this Gradle run starts must not launch Gradle again.
    const r = spawnSync(gradlew, ["-q", "--init-script", script, ":app:lucentClasspath"], {
      cwd: android,
      encoding: "utf8",
      env: { ...process.env, LUCENT_GRADLE_CLASSPATH: "1" },
    });

    record(r.status === 0);
    forgetLoadedSdks();

    if (r.status === 0) return { status: "resolved" };

    return {
      status: "failed",
      detail: `Gradle could not resolve them (retried when the build files or the lockfile change, or with lucent build --force):\n${(r.stderr || r.stdout).trim().split("\n").slice(-8).join("\n")}`,
    };
  } finally {
    fs.rmSync(lock, { force: true });
  }
}

/** Takes `lock` (holding this host and process), or false while a live process holds it. */
function acquire(lock: string): boolean {
  fs.mkdirSync(path.dirname(lock), { recursive: true });

  for (;;) {
    try {
      fs.writeFileSync(lock, `${os.hostname()}\n${process.pid}`, { flag: "wx" });
      return true;
    } catch {
      if (holderAlive(lock)) return false;

      // Its holder died: the lock is stale.
      fs.rmSync(lock, { force: true });
    }
  }
}

/** Whether the process holding `lock` runs (one on another host: assumed to). */
function holderAlive(lock: string): boolean {
  let text: string;
  try {
    text = fs.readFileSync(lock, "utf8");
  } catch {
    return false;
  }

  const [host, pid] = text.split("\n");
  if (host !== os.hostname()) return true;

  try {
    process.kill(Number(pid), 0);
    return true;
  } catch {
    return false;
  }
}

/** Blocks until `lock` is released or its holder dies (a Gradle resolution takes minutes at most). */
function waitFor(lock: string, timeoutMs = 10 * 60_000): void {
  const sleeper = new Int32Array(new SharedArrayBuffer(4));

  for (const start = Date.now(); fs.existsSync(lock) && holderAlive(lock);) {
    if (Date.now() - start > timeoutMs) return;
    Atomics.wait(sleeper, 0, 0, 50);
  }
}

/**
 * What resolving the app's Android dependencies did: nothing to resolve,
 * nothing changed, resolved, left to the Gradle build (no Gradle allowed
 * now, and never resolved), or failed (why).
 */
export type AndroidDependencies =
  | { status: "none" | "cached" | "resolved" | "deferred" }
  | { status: "failed"; detail: string };

/**
 * The native package as autolinking reads it, before a Gradle run or pod
 * install reads the app's autolinking config: the templates
 * (react-native.config.js, package.json, the podspec, the Android library)
 * where missing, the rest left as the last build wrote it, with the Lucent
 * packages' native dependencies for the platforms the build compiles:
 * build.gradle with their Gradle artifacts, so the classpath Gradle
 * resolves has them, and the podspec with their pods, so pod install
 * installs them.
 *
 * React Native caches that config until a JS lockfile changes. When this
 * creates the package, the config cached without it is marked stale, and
 * the next Gradle run reads it again. Returns whether it created the
 * package.
 */
export function writeLinkedPackage(
  root: string,
  out: string,
  native: NativeInputs,
  platforms: { ios?: boolean; android?: boolean },
): boolean {
  const templates = path.join(runtimeDir(), "native");
  const created = !fs.existsSync(path.join(out, "react-native.config.js"));

  for (const file of listFiles(templates)) {
    const to = path.join(out, path.relative(templates, file));

    if (fs.existsSync(to)) continue;

    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.copyFileSync(file, to);
  }

  if (platforms.android) writeGradleDependencies(out, native);
  if (platforms.ios) writePodDependencies(out, native);

  if (created) staleAutolinking(root);

  return created;
}

/**
 * The native package's podspec depending on the Lucent packages' pods, before
 * the rest is written: a check that fails because a package's pod isn't
 * installed yet leaves the pod declared, so pod install installs it and the
 * next build binds it. A podspec an edit took the closing `end` from starts
 * again from the template, as the full build's does.
 */
function writePodDependencies(out: string, native: NativeInputs): void {
  const file = path.join(out, "LucentNative.podspec");
  const text = fs.readFileSync(file, "utf8");
  const from = closesPodspec(text)
    ? text
    : fs.readFileSync(path.join(runtimeDir(), "native/LucentNative.podspec"), "utf8");
  const next = withPodDependencies(from, packagePods(native.manifest));

  if (next !== text) writeWhole(file, next);
}

/**
 * React Native's settings plugin reruns the autolinking config command
 * when a lockfile's recorded hash is missing. Its config, which Gradle
 * tasks of a running build may still read, stays.
 */
export function staleAutolinking(root: string): void {
  const dir = path.join(root, "android/build/generated/autolinking");

  if (!fs.existsSync(dir)) return;

  for (const f of fs.readdirSync(dir)) if (f.endsWith(".sha")) fs.rmSync(path.join(dir, f));
}

function listFiles(dir: string): string[] {
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .flatMap((e) =>
      e.isDirectory() ? listFiles(path.join(dir, e.name)) : [path.join(dir, e.name)],
    );
}

/** The native package's build.gradle with the Lucent packages' Gradle artifacts, before the rest is written. */
function writeGradleDependencies(out: string, native: NativeInputs): void {
  const file = path.join(out, "android/build.gradle");
  // As the last build left them: the next writes the Kotlin shims and Compose content it needs.
  const kotlin = (dir: string) => {
    const at = path.join(out, "android/src/main/java/dev/lucent", dir);

    return fs.existsSync(at)
      ? fs
          .readdirSync(at)
          .filter((f) => f.endsWith(".kt"))
          .map((f) => fs.readFileSync(path.join(at, f), "utf8"))
      : [];
  };
  const text = libraryBuildGradle(
    fs.readFileSync(path.join(runtimeDir(), "native/android/build.gradle"), "utf8"),
    native,
    kotlin("shims").length > 0,
    kotlin("compose"),
  );
  if (fs.existsSync(file) && fs.readFileSync(file, "utf8") === text) return;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  writeWhole(file, text);
}

/**
 * The Lucent packages' pods the app has not installed, with the packages
 * declaring them and what installs them, for a check that failed:
 * installed is what bindgen reads the pods' modules from, the Podfile.lock
 * of the app's installed pods. A build (`wrote`) has declared them in
 * `podspec` already; a check writes nothing.
 *
 * Only where pod install installs them: an app with a Podfile whose
 * react-native.config.js links the native package, as lucent init writes
 * it. In expo prebuild the config plugin links it once a build succeeds.
 */
export function podsToInstall(
  root: string,
  native: ResolvedNative,
  sdk: SdkOptions,
  podspec: string,
  wrote: boolean,
): Notice | undefined {
  const config = path.join(root, "react-native.config.js");
  const linked =
    fs.existsSync(config) && linkNativePackage(fs.readFileSync(config, "utf8")) === undefined;
  if (!linked || !fs.existsSync(path.join(root, "ios/Podfile"))) return undefined;

  const installed = new Set(sdk.ios?.lockfile ? lockedPods(sdk.ios.lockfile).keys() : []);
  const missing = Object.entries(native.ios.pods).filter(
    ([pod]) => !installed.has(pod.split("/")[0]!),
  );
  if (!missing.length) return undefined;

  const named = missing.map(
    ([pod, asked]) => `${[...new Set(Object.values(asked).flat())].join(" and ")}'s pod ${pod}`,
  );
  const subject = `${named.join(", ")} ${missing.length === 1 ? "is" : "are"} not installed`;
  const them = missing.length === 1 ? "it" : "them";

  return {
    level: "warn",
    text: wrote
      ? `${subject}: ${podspec} depends on ${them}; run pod install in ios/, then lucent build`
      : `${subject}: run lucent build, which adds ${them} to ${podspec}, then pod install in ios/`,
  };
}

/** The app's property lists Lucent packages add entries to, and where the build finds them. */
const APP_PLISTS = [
  {
    entries: (n: ResolvedNative) => n.ios.infoPlist,
    files: (dir: string) => ["Info.plist"].filter((f) => fs.existsSync(path.join(dir, f))),
    none: "the app has no Info.plist",
  },
  {
    entries: (n: ResolvedNative) => n.ios.entitlements,
    files: (dir: string) => fs.readdirSync(dir).filter((f) => f.endsWith(".entitlements")),
    none: "the app's target has no .entitlements file",
  },
];

/**
 * Info.plist entries and entitlements Lucent packages need that the app's
 * files lack: named, since the app's files are its own. An array names the
 * values it lacks; the app's own value of any other key stands.
 */
export function missingAppEntries(root: string, native: ResolvedNative): Notice[] {
  const ios = path.join(root, "ios");
  const targets = fs.existsSync(ios)
    ? fs
        .readdirSync(ios, { withFileTypes: true })
        .filter((e) => e.isDirectory())
        .map((e) => path.join(ios, e.name))
    : [];

  const out: Notice[] = [];
  const warn = (text: string) =>
    out.push({ level: "warn", text: `${text} (the Expo config plugin adds it)` });
  const who = (from: string[]) => `${from.join(" and ")} ${from.length === 1 ? "needs" : "need"}`;

  for (const { entries, files, none } of APP_PLISTS) {
    const keys = Object.entries(entries(native));
    const found = targets.flatMap((dir) => files(dir).map((f) => path.join(dir, f)));

    if (!keys.length || !targets.length) continue;

    if (!found.length) for (const [key, { from }] of keys) warn(`${who(from)} ${key}, but ${none}`);

    for (const file of found) {
      const app = plistEntries(fs.readFileSync(file, "utf8"));
      const where = path.relative(root, file);

      for (const [key, { value, from }] of keys) {
        const has = app.get(key);

        if (has === undefined) warn(`${who(from)} ${key} in ${where}`);
        else if (Array.isArray(value))
          for (const v of value.filter((v) => !(Array.isArray(has) && has.includes(v))))
            warn(`${who(from)} ${JSON.stringify(v)} in ${key} in ${where}`);
      }
    }
  }

  return out;
}

/**
 * The entries of an XML property list: strings, booleans and arrays of
 * strings by value, any other value as present (null).
 */
function plistEntries(text: string): Map<string, PlistValue | null> {
  const out = new Map<string, PlistValue | null>();
  const entry =
    /<key>([^<]*)<\/key>\s*(?:<string>([^<]*)<\/string>|<(true|false)\/>|<array>([\s\S]*?)<\/array>|<array\/>)?/g;

  for (const m of text.matchAll(entry)) {
    const [, key, string, boolean, array] = m;

    out.set(
      key!,
      string !== undefined
        ? string
        : boolean !== undefined
          ? boolean === "true"
          : array !== undefined || m[0].endsWith("<array/>")
            ? [...(array ?? "").matchAll(/<string>([^<]*)<\/string>/g)].map((s) => s[1]!)
            : null,
    );
  }

  return out;
}

/** What decides the app's Android classpath: Gradle's files, and the JS lockfile (autolinked packages). */
function gradleInputsHash(root: string, native: ResolvedNative): string {
  const android = path.join(root, "android");
  const gradle = [
    "settings.gradle",
    "settings.gradle.kts",
    "build.gradle",
    "build.gradle.kts",
    "app/build.gradle",
    "app/build.gradle.kts",
    "gradle.properties",
    "gradle/libs.versions.toml",
  ].map((f) => path.join(android, f));
  const h = createHash("sha256");
  for (const f of [...gradle, ...lockfiles(root)])
    h.update(`${f}\0${fs.existsSync(f) ? fs.readFileSync(f) : ""}\0`);
  h.update(JSON.stringify(native.android.dependencies));
  return h.digest("hex").slice(0, 16);
}

/** The app's Android project's Gradle wrapper, where the project has one. */
const gradlewOf = (root: string) =>
  path.join(root, "android", process.platform === "win32" ? "gradlew.bat" : "gradlew");

/** Whether the app has its Android project (a Gradle wrapper to resolve its dependencies). */
export const hasAndroidProject = (root: string) => fs.existsSync(gradlewOf(root));

/**
 * The Android modules `files` import that neither android.jar nor Lucent
 * packages' libraries declare, while nothing has resolved the app's
 * dependencies: none once a Gradle build resolved its classpath. Where the
 * app has an Android project, this build resolves them unless it leaves
 * Android out (`withProject`: it builds other platforms alone).
 */
export function pendingAndroidModules(
  root: string,
  files: string[],
  sdk: SdkOptions,
  withProject = false,
): string[] {
  const imports = sdkImports(files).android;
  const resolved = sdk.android?.classpath && fs.existsSync(sdk.android.classpath);

  if (!imports.length || resolved || (!withProject && hasAndroidProject(root))) return [];

  const available = sdkModules("android", sdk);
  if (!Array.isArray(available)) return [];

  const declared = new Set(available);
  return imports.filter((m) => !declared.has(m));
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
  for (const f of files)
    for (const m of fs.readFileSync(f, "utf8").matchAll(/["']lucent:(ios|android)\/([\w.]+)["']/g))
      out[m[1] as "ios" | "android"].add(m[2]!);
  return { ios: [...out.ios].sort(), android: [...out.android].sort() };
}

/**
 * The `lucent sdk prefetch` arguments of each background process: the
 * built platforms' imports, dealt round robin to at most `slots`
 * processes, so the build, extracting in order, finds the first ones
 * under way. Each process loads the compiler: one per module would
 * exhaust a small machine's memory.
 */
export function prefetchJobs(
  imports: Record<Platform, string[]>,
  platforms: readonly Platform[],
  slots: number,
): string[][] {
  const jobs = platforms.flatMap((p) => imports[p].map((m) => [p, m] as const));
  const count = Math.min(jobs.length, slots);

  return Array.from({ length: count }, (_, i) => {
    const mine = jobs.filter((_, j) => j % count === i);

    // An empty list would mean every module of the platform.
    return platforms.flatMap((p) => {
      const modules = mine.filter(([q]) => q === p).map(([, m]) => m);
      return modules.length ? [`--${p}`, modules.join(",")] : [];
    });
  });
}

/**
 * Extracts the built platforms' imported modules in background processes,
 * one per spare core: the build then waits on their locks instead of
 * extracting them one after another.
 */
export function backgroundPrefetch(
  root: string,
  files: string[],
  platforms: readonly Platform[],
): void {
  const slots = Math.max(1, os.availableParallelism() - 1);

  for (const args of prefetchJobs(sdkImports(files), platforms, slots)) {
    const child = spawn(
      process.execPath,
      [process.argv[1]!, "sdk", "prefetch", ...args, "--root", root],
      { detached: true, stdio: "ignore" },
    );
    child.unref();
  }
}
