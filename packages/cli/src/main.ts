import fs from "node:fs";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { compile, findLucentFiles, forgetLoadedSdks, formatDiagnostic, inputsKey, isUpToDate, platformOf, podsSearchPaths, prefetchSdk, sdkAvailable, sdkModule, sdkModules, type SdkOptions, type Target, watchBuild, writeNativePackage } from "@lucent-lang/compiler";

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
  lucent init  [--root <dir>]                 Wire an app: react-native.config.js, .gitignore, tsconfig
`;

const LUCENT_GRADLE = 'rootProject.file("../.lucent/native/android/lucent.gradle")';
const LUCENT_GRADLE_APPLY = `
// Lucent: lucent:android bindings for the app's dependencies (the file is written by lucent build).
def lucentGradle = ${LUCENT_GRADLE}
if (lucentGradle.exists()) apply from: lucentGradle
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
  if (command !== "build" && command !== "check") {
    process.stderr.write(`Unknown command: ${command}\n\n${HELP}`);
    return 1;
  }
  if (command === "build" && process.argv.includes("--watch")) return watch(root);
  const files = findLucentFiles(root);
  if (files.length === 0) {
    process.stdout.write(`No *.lucent.ts files under ${root}\n`);
  }
  const t0 = Date.now();
  const sdk = projectSdk(root);
  if (command === "build") resolveAndroidDependencies(root, files, sdk);
  const out = path.resolve(arg("--out", path.join(root, ".lucent/native")));
  const platformsArg = arg("--platforms", "");
  let platforms = platformsArg ? (platformsArg.split(",") as Target[]) : undefined;
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
  const key = inputsKey(files, out) + (platforms ? `:${platforms.join(",")}` : "");
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
  const w = writeNativePackage(result, out, { inputsKey: key });
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
 * dependencies: resolve them with Gradle (the lucentClasspath task of
 * lucent.gradle) when that has not happened yet or the build files changed.
 */
function resolveAndroidDependencies(root: string, files: string[], sdk: SdkOptions): void {
  const imports = sdkImports(files).android;
  const android = path.join(root, "android");
  const gradlew = path.join(android, process.platform === "win32" ? "gradlew.bat" : "gradlew");
  const classpath = sdk.android!.classpath!;
  if (!imports.length || !fs.existsSync(gradlew)) return;
  const age = fs.existsSync(classpath) ? fs.statSync(classpath).mtimeMs : 0;
  const changed = [path.join(android, "build.gradle"), path.join(android, "app/build.gradle")].some((f) => fs.existsSync(f) && fs.statSync(f).mtimeMs > age);
  const unresolved = imports.some((m) => "missing" in sdkModule("android", m, sdk));
  if (!unresolved && !(changed && age)) return;
  process.stdout.write("• resolving the app's Android dependencies (Gradle :app:lucentClasspath)\n");
  const r = spawnSync(gradlew, ["-q", ":app:lucentClasspath"], { cwd: android, encoding: "utf8" });
  if (r.status !== 0) {
    process.stderr.write(`! Gradle could not resolve them:\n${(r.stderr || r.stdout).trim().split("\n").slice(-8).join("\n")}\n  Does android/app/build.gradle apply lucent.gradle? (lucent init adds it)\n`);
  }
  forgetLoadedSdks();
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
  if (!wanted.ios && !wanted.android && !all) wanted = sdkImports(findLucentFiles(root));
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
  }, { sdk: projectSdk(root) });
  return -1;
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
  const appGradle = path.join(root, "android/app/build.gradle");
  if (fs.existsSync(appGradle) && !fs.readFileSync(appGradle, "utf8").includes(LUCENT_GRADLE)) {
    fs.appendFileSync(appGradle, LUCENT_GRADLE_APPLY);
    process.stdout.write("✓ applied lucent.gradle in android/app/build.gradle (bindings for the app's dependencies)\n");
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
