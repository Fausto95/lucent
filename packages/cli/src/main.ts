import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { compile, forgetLoadedSdks, formatDiagnostic, inputsKey, isUpToDate, platformOf, lucentPackages, nativeDependencies, sdkCoverage, type SdkCoverage, type NativeDependencies, podsSearchPaths, prefetchSdk, projectFiles, withGradleDependencies, sdkAvailable, sdkModule, sdkModules, runtimeDir, type SdkOptions, type Target, watchBuild, writeNativePackage } from "@lucent-lang/compiler";

const HELP = `lucent — compile *.lucent.ts modules into a native React Native package

Usage:
  lucent build [--root <dir>] [--out <dir>] [--force] [--platforms ios,android,host]
                                             Compile and write the native package (default out: <root>/.lucent/native);
                                             skipped when nothing changed since the last build, unless --force.
                                             Platform modules (*.ios.lucent.ts, *.android.lucent.ts) are built for
                                             --platforms (default ios,android; host: stubs, for tests and tools)
  lucent build --watch [--root <dir>]         Build, then rebuild whenever a *.lucent.ts file changes
  lucent check [--root <dir>]                 Type-check and validate without writing anything
  lucent sdk prefetch [--ios A,B] [--android p.q,…] [--all] [--root <dir>]
                                             Extract SDK bindings into the cache ahead of use (default: the
                                             lucent:* modules the project imports; --all: every module)
  lucent sdk coverage [--ios A,B] [--android p.q,…] [--json] [--check <baseline.json>]
                                             Members Lucent code can call per module: idiomatic, raw,
                                             unrepresentable (--check fails when that grows past a baseline)
  lucent init  [--root <dir>]                 Wire an app: react-native.config.js, .gitignore, tsconfig
`;

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1]! : fallback;
}

function run(): number {
  const command = process.argv[2];
  const root = path.resolve(arg("--root", process.cwd()));
  if (!command || command === "--help" || command === "-h" || command === "help") {
    process.stdout.write(HELP);
    return command ? 0 : 1;
  }
  if (command === "init") return init(root);
  if (command === "sdk" && process.argv[3] === "prefetch") return sdkPrefetch(root);
  if (command === "sdk" && process.argv[3] === "coverage") return sdkCoverageReport(root);
  if (command !== "build" && command !== "check") {
    process.stderr.write(`Unknown command: ${command}\n\n${HELP}`);
    return 1;
  }
  if (command === "build" && process.argv.includes("--watch")) return watch(root);
  let files: string[];
  let native: NativeDependencies;
  try {
    files = projectFiles(root);
    native = nativeDependencies(lucentPackages(root));
  } catch (e) {
    process.stderr.write(`✗ ${(e as Error).message}\n`);
    return 1;
  }
  if (files.length === 0) {
    process.stdout.write(`No *.lucent.ts files under ${root}\n`);
  }
  const t0 = Date.now();
  const sdk = projectSdk(root);
  const out = path.resolve(arg("--out", path.join(root, ".lucent/native")));
  const platformsArg = arg("--platforms", "");
  let platforms = platformsArg ? (platformsArg.split(",") as Target[]) : undefined;
  // A host build has the platform modules' stubs: no Android dependencies to resolve.
  if (command === "build" && (!platforms || platforms.includes("android"))) {
    // Packages' Gradle artifacts are on the classpath Lucent binds from: the
    // library declares them before Gradle resolves it.
    writeGradleDependencies(out, native);
    resolveAndroidDependencies(root, files, sdk, native);
  }
  if (!platforms && files.some((f) => platformOf(f))) {
    // Build what this machine can: an Android-only Linux host, a Mac without the Android SDK.
    const installed = (["ios", "android"] as const).filter((p) => sdkAvailable(p, sdk));
    for (const p of ["ios", "android"] as const) {
      if (installed.includes(p)) continue;
      const why = sdkModule(p, p === "ios" ? "Foundation" : "android.os", sdk);
      process.stderr.write(`! ${"missing" in why ? why.missing : `no ${p} SDK`}; skipped ${p === "ios" ? "iOS" : "Android"} (build it with --platforms ${p} once the SDK is installed).\n`);
    }
    if (!installed.length) {
      process.stderr.write("✗ no platform SDK is installed.\n");
      return 1;
    }
    platforms = installed;
    if (command === "build") backgroundPrefetch(root, files);
  }
  const key = inputsKey(files, out) + (platforms ? `:${platforms.join(",")}` : "") + `:${createHash("sha256").update(JSON.stringify(native)).digest("hex").slice(0, 12)}`;
  if (command === "build" && !process.argv.includes("--force") && isUpToDate(out, key)) {
    process.stdout.write(`✓ ${path.relative(root, out)} is up to date (${files.length} module(s), ${Date.now() - t0} ms)\n`);
    return 0;
  }
  const result = compile(files, { platforms, sdk });
  for (const d of result.diagnostics) process.stderr.write(formatDiagnostic({ ...d, file: d.file && path.relative(root, d.file) }) + "\n");
  if (!result.ok) {
    process.stderr.write(`\n✗ ${result.diagnostics.length} problem(s); nothing was written.\n`);
    return 1;
  }
  const names = [...result.proxies.keys()];
  if (command === "check") {
    process.stdout.write(`✓ ${names.length} module(s) OK: ${names.join(", ")} (${Date.now() - t0} ms)\n`);
    return 0;
  }
  const w = writeNativePackage(result, out, { inputsKey: key, native });
  warnInfoPlist(root, native);
  process.stdout.write(`✓ Compiled ${names.length} module(s): ${names.join(", ")} (${Date.now() - t0} ms)\n`);
  process.stdout.write(`  ${path.relative(root, out)}: ${w.written.length} written, ${w.unchanged} unchanged, ${w.removed.length} removed\n`);
  if (w.structureChanged) {
    process.stdout.write(`  Native files were added or removed: run \`pod install\` (iOS) before the next build.\n`);
  }
  return 0;
}

/** Where this project's bindings come from: the SDKs, and what the app links. */
function projectSdk(root: string): SdkOptions {
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
function resolveAndroidDependencies(root: string, files: string[], sdk: SdkOptions, native: NativeDependencies): void {
  const android = path.join(root, "android");
  const gradlew = path.join(android, process.platform === "win32" ? "gradlew.bat" : "gradlew");
  if (!sdkImports(files).android.length || !fs.existsSync(gradlew)) return;
  const stateFile = path.join(root, ".lucent/android-classpath.state.json");
  const inputs = gradleInputsHash(root, native);
  const state = fs.existsSync(stateFile) ? (JSON.parse(fs.readFileSync(stateFile, "utf8")) as { inputs?: string; ok?: boolean }) : {};
  const force = process.argv.includes("--force");
  if (!force && state.inputs === inputs && state.ok === false) {
    process.stderr.write("! Gradle could not resolve the app's Android dependencies for these build files before; lucent build --force retries.\n");
    return;
  }
  if (!force && state.inputs === inputs && fs.existsSync(sdk.android!.classpath!)) return;
  process.stdout.write("• resolving the app's Android dependencies (Gradle :app:lucentClasspath)\n");
  const script = path.join(runtimeDir(), "gradle/lucent-classpath.init.gradle");
  const r = spawnSync(gradlew, ["-q", "--init-script", script, ":app:lucentClasspath"], { cwd: android, encoding: "utf8" });
  if (r.status !== 0) {
    process.stderr.write(`! Gradle could not resolve them (retried when the build files or the lockfile change, or with lucent build --force):\n${(r.stderr || r.stdout).trim().split("\n").slice(-8).join("\n")}\n`);
  }
  fs.mkdirSync(path.dirname(stateFile), { recursive: true });
  fs.writeFileSync(stateFile, JSON.stringify({ inputs, ok: r.status === 0 }) + "\n");
  forgetLoadedSdks();
}

/** The native package's build.gradle with the Lucent packages' Gradle artifacts, before the rest is written. */
function writeGradleDependencies(out: string, native: NativeDependencies): void {
  const file = path.join(out, "android/build.gradle");
  const text = withGradleDependencies(fs.readFileSync(path.join(runtimeDir(), "native/android/build.gradle"), "utf8"), native);
  if (fs.existsSync(file) && fs.readFileSync(file, "utf8") === text) return;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
}

/** Info.plist keys Lucent packages need that the app's Info.plist lacks: named, since the app's files are its own. */
function warnInfoPlist(root: string, native: NativeDependencies): void {
  const keys = Object.entries(native.infoPlist);
  if (!keys.length) return;
  const ios = path.join(root, "ios");
  const plists = fs.existsSync(ios) ? fs.readdirSync(ios).map((d) => path.join(ios, d, "Info.plist")).filter((f) => fs.existsSync(f)) : [];
  for (const plist of plists) {
    const text = fs.readFileSync(plist, "utf8");
    for (const [key, { from }] of keys) {
      if (!text.includes(`<key>${key}</key>`)) process.stdout.write(`! ${from} needs ${key} in ${path.relative(root, plist)} (the Expo config plugin adds it)\n`);
    }
  }
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
function sdkImports(files: string[]): { ios: string[]; android: string[] } {
  const out = { ios: new Set<string>(), android: new Set<string>() };
  for (const f of files) for (const m of fs.readFileSync(f, "utf8").matchAll(/["']lucent:(ios|android)\/([\w.]+)["']/g)) out[m[1] as "ios" | "android"].add(m[2]!);
  return { ios: [...out.ios].sort(), android: [...out.android].sort() };
}

/**
 * Extracts each imported module in its own background process: the build
 * then waits on their locks instead of extracting them one after another.
 */
function backgroundPrefetch(root: string, files: string[]): void {
  const imports = sdkImports(files);
  for (const p of ["ios", "android"] as const) {
    for (const m of imports[p]) {
      const child = spawn(process.execPath, [process.argv[1]!, "sdk", "prefetch", `--${p}`, m, "--root", root], { detached: true, stdio: "ignore" });
      child.unref();
    }
  }
}

function sdkPrefetch(root: string): number {
  const listed = (p: string) => {
    const i = process.argv.indexOf(`--${p}`);
    return i < 0 ? undefined : (process.argv[i + 1] && !process.argv[i + 1]!.startsWith("--") ? process.argv[i + 1]!.split(",") : []);
  };
  const all = process.argv.includes("--all");
  let wanted = { ios: listed("ios"), android: listed("android") };
  if (!wanted.ios && !wanted.android && !all) wanted = sdkImports(projectFiles(root));
  let failed = 0;
  for (const p of ["ios", "android"] as const) {
    let modules = wanted[p];
    if (all || (modules && !modules.length)) {
      const everything = sdkModules(p, projectSdk(root));
      if (!Array.isArray(everything)) {
        process.stderr.write(`✗ ${everything.missing}\n`);
        failed++;
        continue;
      }
      modules = everything;
    }
    for (const [i, r] of prefetchSdk(p, modules ?? [], projectSdk(root)).entries()) {
      const name = `lucent:${p}/${modules![i]}`;
      if ("schema" in r) process.stdout.write(`✓ ${name}\n`);
      else {
        process.stderr.write(`✗ ${r.missing}\n`);
        failed++;
      }
    }
  }
  return failed ? 1 : 0;
}

function watch(root: string): number {
  const out = path.resolve(arg("--out", path.join(root, ".lucent/native")));
  process.stdout.write(`Lucent: watching ${root} for *.lucent.ts changes\n`);
  watchBuild(root, out, (e) => {
    const time = new Date().toLocaleTimeString();
    if (!e.ok) {
      process.stderr.write(`[${time}] ✗ Lucent build failed:\n${e.messages.map((m) => `  ${m}`).join("\n")}\n`);
      return;
    }
    process.stdout.write(`[${time}] ✓ Lucent: ${e.messages.join("; ")}\n`);
    if (e.nativeChanged) process.stdout.write("  Native code changed: rebuild the app (Xcode / Gradle) to run it.\n");
  }, { sdk: projectSdk(root) }, {
    native: () => nativeDependencies(lucentPackages(root)),
    beforeBuild: (files) => {
      const native = nativeDependencies(lucentPackages(root));
      writeGradleDependencies(out, native);
      resolveAndroidDependencies(root, files, projectSdk(root), native);
    },
  });
  return -1;
}

/** `lucent sdk coverage`: per module, how much Lucent code can call, and how. */
function sdkCoverageReport(root: string): number {
  const sdk = projectSdk(root);
  const list = (flag: string) => arg(flag, "").split(",").filter(Boolean);
  const wanted = { ios: list("--ios"), android: list("--android") };
  if (!wanted.ios.length && !wanted.android.length) Object.assign(wanted, sdkImports(projectFiles(root)));
  const reports: SdkCoverage[] = [];
  for (const platform of ["ios", "android"] as const) {
    // `android.*`: every module with the prefix.
    const listed = () => {
      const all = sdkModules(platform, sdk);
      return "missing" in all ? [] : all;
    };
    const modules = wanted[platform].flatMap((m) => (m.endsWith(".*") ? listed().filter((x) => x.startsWith(m.slice(0, -1))) : [m]));
    for (const m of modules) {
      const r = sdkModule(platform, m, sdk);
      if ("missing" in r) {
        process.stderr.write(`✗ ${r.missing}\n`);
        return 1;
      }
      reports.push(sdkCoverage(r.schema));
    }
  }
  if (process.argv.includes("--json")) process.stdout.write(`${JSON.stringify(reports, null, 2)}\n`);
  else {
    const pct = (n: number, t: number) => `${t ? ((100 * n) / t).toFixed(1) : "0.0"}%`;
    process.stdout.write(`${"module".padEnd(28)} ${"total".padStart(7)} ${"idiomatic".padStart(10)} ${"raw".padStart(8)} ${"unrepresentable".padStart(16)}\n`);
    for (const c of reports) process.stdout.write(`${c.module.padEnd(28)} ${String(c.total).padStart(7)} ${String(c.idiomatic).padStart(10)} ${String(c.raw).padStart(8)} ${`${c.unrepresentable} (${pct(c.unrepresentable, c.total)})`.padStart(16)}\n`);
  }
  const baselineFile = arg("--check", "");
  if (!baselineFile) return 0;
  const baseline = new Map((JSON.parse(fs.readFileSync(baselineFile, "utf8")) as SdkCoverage[]).map((c) => [c.module, c]));
  // Shares, not counts: another SDK version has other members.
  const share = (c: SdkCoverage) => (c.total ? (100 * c.unrepresentable) / c.total : 0);
  let dropped = false;
  for (const c of reports) {
    const b = baseline.get(c.module);
    if (b && share(c) > share(b) + 0.05) {
      process.stderr.write(`✗ ${c.module}: ${share(c).toFixed(2)}% unrepresentable, ${share(b).toFixed(2)}% in the baseline\n`);
      dropped = true;
    }
  }
  return dropped ? 1 : 0;
}

function init(root: string): number {
  const rnConfig = path.join(root, "react-native.config.js");
  const entry = `"lucent": { root: require("path").join(__dirname, ".lucent", "native") }`;
  const text = fs.existsSync(rnConfig) ? fs.readFileSync(rnConfig, "utf8") : undefined;
  if (text === undefined) {
    fs.writeFileSync(rnConfig, `module.exports = {\n  dependencies: {\n    ${entry},\n  },\n};\n`);
    process.stdout.write("✓ wrote react-native.config.js\n");
  } else if (text.includes('"lucent-native"')) {
    // Earlier versions named the dependency lucent-native.
    fs.writeFileSync(rnConfig, text.replace('"lucent-native"', '"lucent"'));
    process.stdout.write("✓ renamed the lucent-native dependency to lucent in react-native.config.js\n");
  } else if (!/["']lucent["']\s*:/.test(text)) {
    process.stdout.write(`! add this to the "dependencies" of react-native.config.js:\n    ${entry}\n`);
  }
  const gitignore = path.join(root, ".gitignore");
  const ignored = fs.existsSync(gitignore) ? fs.readFileSync(gitignore, "utf8") : "";
  if (!ignored.split("\n").includes(".lucent/")) {
    fs.appendFileSync(gitignore, `${ignored.endsWith("\n") || !ignored ? "" : "\n"}.lucent/\n`);
    process.stdout.write("✓ added .lucent/ to .gitignore\n");
  }
  process.stdout.write(
    "Next: wrap your Metro config with withLucent() from @lucent-lang/metro, and enable\n" +
      '"noUncheckedIndexedAccess": true in tsconfig.json (Lucent requires it).\n' +
      'Platform modules (*.ios.lucent.ts, *.android.lucent.ts) import lucent:*; for your editor and tsc, add\n' +
      '  "paths": { "lucent:*": ["./.lucent/native/types/*"] }\n' +
      'to the compilerOptions of tsconfig.json (lucent build writes those declarations).\n',
  );
  return 0;
}

const status = run();
// Watch mode keeps running.
if (status >= 0) process.exit(status);
