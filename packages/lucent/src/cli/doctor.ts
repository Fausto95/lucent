import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { lucentPackages } from "@lucent-lang/compiler/packages";
import { packageManagerOf } from "./package-manager.ts";

export interface RunResult {
  status: number | null;
  stdout: string;
  stderr: string;
}

/** What doctor asks of the machine; tests pass a fake one. Project files are read from disk. */
export interface Probe {
  platform: NodeJS.Platform;
  env: Record<string, string | undefined>;
  home: string;
  nodeVersion: string;
  cliVersion: string;
  run(cmd: string, args: string[]): RunResult;
}

export interface Check {
  id: string;
  label: string;
  status: "ok" | "warn" | "fail" | "skip";
  detail: string;
  fix?: string;
}

export function systemProbe(cliVersion: string): Probe {
  return {
    platform: process.platform,
    env: process.env,
    home: os.homedir(),
    nodeVersion: process.version,
    cliVersion,
    run: (cmd, args) => {
      const r = spawnSync(cmd, args, { encoding: "utf8", timeout: 20_000 });
      return { status: r.error ? null : r.status, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
    },
  };
}

const read = (file: string): string | undefined => (fs.existsSync(file) ? fs.readFileSync(file, "utf8") : undefined);
const json = <T>(file: string): T | undefined => {
  const text = read(file);
  return text === undefined ? undefined : (JSON.parse(text) as T);
};

/** [major, minor, patch] of a version string, prerelease ignored. */
function parse(version: string): number[] {
  return (/(\d+)\.(\d+)(?:\.(\d+))?/.exec(version) ?? []).slice(1, 4).map((n) => Number(n ?? 0));
}

function atLeast(version: string, min: string): boolean {
  const [a, b] = [parse(version), parse(min)];
  for (let i = 0; i < 3; i++) if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) > (b[i] ?? 0);
  return true;
}

/** The app's installed version of a package, as Node resolves it from the app (monorepos: up the tree). */
function installed(root: string, name: string): string | undefined {
  for (let dir = root; ; dir = path.dirname(dir)) {
    const pkg = json<{ version?: string }>(path.join(dir, "node_modules", name, "package.json"));
    if (pkg?.version) return pkg.version;
    if (path.dirname(dir) === dir) return undefined;
  }
}

const ok = (id: string, label: string, detail: string): Check => ({ id, label, status: "ok", detail });
const fail = (id: string, label: string, detail: string, fix: string): Check => ({ id, label, status: "fail", detail, fix });
const warn = (id: string, label: string, detail: string, fix: string): Check => ({ id, label, status: "warn", detail, fix });
const skip = (id: string, label: string, detail: string): Check => ({ id, label, status: "skip", detail });

/** Every check, in the order doctor prints them. */
export function diagnose(root: string, probe: Probe): Check[] {
  const pkg = json<{ dependencies?: Record<string, string>; devDependencies?: Record<string, string> }>(path.join(root, "package.json")) ?? {};
  const deps = { ...pkg.dependencies, ...pkg.devDependencies };
  const expo = "expo" in deps;
  const mac = probe.platform === "darwin";
  return [
    node(probe),
    packageManager(root),
    reactNative(root),
    expo ? expoSdk(root) : skip("expo", "Expo SDK", "not an Expo app"),
    ...(mac ? [xcode(probe), simulator(probe), cocoapods(probe)] : [skip("xcode", "Xcode", "iOS builds need a Mac")]),
    ...android(probe),
    jdk(probe),
    gradleTask(root, expo),
    metro(root),
    tsconfig(root),
    sdkCache(probe),
    versions(root, probe),
  ];
}

function node(probe: Probe): Check {
  return atLeast(probe.nodeVersion, "22.12.0") ? ok("node", "Node.js", probe.nodeVersion) : fail("node", "Node.js", `${probe.nodeVersion}; Lucent needs 22.12 or later`, "install Node.js 22.12 or later (nodejs.org, or your version manager)");
}

function packageManager(root: string): Check {
  const pm = packageManagerOf(root);
  if (!pm) return warn("package-manager", "Package manager", "no lockfile", "install the app's dependencies (npm install, pnpm install, …)");
  return ok("package-manager", "Package manager", `${pm.name} (${path.relative(root, pm.lockfile)})`);
}

function reactNative(root: string): Check {
  const v = installed(root, "react-native");
  if (!v) return fail("react-native", "React Native", "not installed", "install react-native 0.88 or later in the app");
  return atLeast(v, "0.88.0") ? ok("react-native", "React Native", v) : fail("react-native", "React Native", `${v}; Lucent needs 0.88 or later (the New Architecture's C++ TurboModules)`, "upgrade react-native to 0.88 or later");
}

function expoSdk(root: string): Check {
  const v = installed(root, "expo");
  if (!v) return fail("expo", "Expo SDK", "expo is a dependency but is not installed", "install the app's dependencies");
  return atLeast(v, "58.0.0") ? ok("expo", "Expo SDK", `${parse(v)[0]} (expo ${v})`) : fail("expo", "Expo SDK", `expo ${v}; Lucent needs SDK 58 or later`, "upgrade to Expo SDK 58 (npx expo install expo@^58)");
}

function xcode(probe: Probe): Check {
  const r = probe.run("xcodebuild", ["-version"]);
  if (r.status !== 0) return fail("xcode", "Xcode", "not found", "install Xcode from the App Store, then: sudo xcode-select -s /Applications/Xcode.app");
  return ok("xcode", "Xcode", r.stdout.split("\n")[0]!.replace(/^Xcode /, ""));
}

function simulator(probe: Probe): Check {
  const r = probe.run("xcrun", ["simctl", "list", "runtimes", "--json"]);
  const runtimes = r.status === 0 ? ((JSON.parse(r.stdout) as { runtimes?: { name: string; platform?: string; isAvailable?: boolean }[] }).runtimes ?? []) : [];
  const ios = runtimes.filter((rt) => rt.isAvailable !== false && (rt.platform === "iOS" || rt.name.startsWith("iOS")));
  return ios.length ? ok("simulator", "iOS simulator runtime", ios.map((rt) => rt.name).join(", ")) : warn("simulator", "iOS simulator runtime", "none installed", "install one in Xcode: Settings > Components");
}

function cocoapods(probe: Probe): Check {
  const r = probe.run("pod", ["--version"]);
  return r.status === 0 ? ok("cocoapods", "CocoaPods", r.stdout.trim()) : fail("cocoapods", "CocoaPods", "not installed", "brew install cocoapods (or: sudo gem install cocoapods)");
}

function android(probe: Probe): Check[] {
  const candidates = [probe.env.ANDROID_HOME, probe.env.ANDROID_SDK_ROOT, path.join(probe.home, probe.platform === "darwin" ? "Library/Android/sdk" : "Android/Sdk")].filter((d): d is string => !!d);
  const sdk = candidates.find((d) => fs.existsSync(path.join(d, "platforms")));
  if (!sdk) {
    return [
      fail("android-sdk", "Android SDK", "not found", "install Android Studio (or the command-line tools), then set ANDROID_HOME to the SDK (e.g. ~/Library/Android/sdk)"),
      skip("ndk", "Android NDK", "needs the Android SDK"),
    ];
  }
  const platforms = fs.readdirSync(path.join(sdk, "platforms")).filter((p) => /^android-\d+/.test(p)).sort((a, b) => Number(b.slice(8)) - Number(a.slice(8)));
  const sdkCheck = platforms.length
    ? ok("android-sdk", "Android SDK", `${platforms[0]} at ${sdk.replace(probe.home, "~")}`)
    : fail("android-sdk", "Android SDK", `no platform installed at ${sdk}`, "install one with Android Studio's SDK Manager, or: sdkmanager 'platforms;android-36'");
  const envSet = probe.env.ANDROID_HOME || probe.env.ANDROID_SDK_ROOT;
  const ndks = fs.existsSync(path.join(sdk, "ndk")) ? fs.readdirSync(path.join(sdk, "ndk")).sort() : [];
  const ndkCheck = ndks.length ? ok("ndk", "Android NDK", ndks.at(-1)!) : fail("ndk", "Android NDK", "not installed", "install it with Android Studio's SDK Manager (SDK Tools > NDK), or: sdkmanager 'ndk;27.1.12297006'");
  if (sdkCheck.status === "ok" && !envSet) return [{ ...sdkCheck, status: "warn", fix: `export ANDROID_HOME=${sdk.replace(probe.home, "$HOME")} (Gradle and adb find the SDK through it)` }, ndkCheck];
  return [sdkCheck, ndkCheck];
}

function jdk(probe: Probe): Check {
  const r = probe.run("java", ["-version"]);
  if (r.status !== 0) return fail("jdk", "JDK", "not found", "install JDK 17 or 21 (e.g. brew install --cask zulu@21) and set JAVA_HOME");
  const m = /version "(\d+)(?:\.(\d+))?/.exec(r.stderr + r.stdout);
  const major = m ? Number(m[1] === "1" ? m[2] : m[1]) : 0;
  if (major >= 17 && major <= 21) return ok("jdk", "JDK", String(major));
  return warn("jdk", "JDK", `${major || "unknown version"}; React Native's Gradle build needs 17 to 21`, "set JAVA_HOME to JDK 17 or 21 (macOS: export JAVA_HOME=$(/usr/libexec/java_home -v 21))");
}

function gradleTask(root: string, expo: boolean): Check {
  const file = ["android/app/build.gradle", "android/app/build.gradle.kts"].map((f) => path.join(root, f)).find((f) => fs.existsSync(f));
  if (!file) return skip("gradle-task", "Lucent Gradle task", expo ? "no android/ yet (expo prebuild adds it)" : "no android/app/build.gradle");
  const text = read(file)!;
  return /lucent\.gradle/.test(text) ? ok("gradle-task", "Lucent Gradle task", "applied in android/app") : fail("gradle-task", "Lucent Gradle task", "android/app/build.gradle does not apply it, so Gradle builds may use an old .lucent/native", expo ? "run expo prebuild again (the Lucent config plugin adds it), or lucent init" : "run lucent init");
}

function metro(root: string): Check {
  const file = ["metro.config.js", "metro.config.cjs", "metro.config.mjs", "metro.config.ts"].map((f) => path.join(root, f)).find((f) => fs.existsSync(f));
  const fix = 'wrap the config: const { withLucent } = require("@lucent-lang/lucent/metro"); module.exports = withLucent(config);';
  if (!file) return fail("metro", "Metro config", "no metro.config.js", fix);
  const text = read(file)!;
  return /withLucent/.test(text) && /@lucent-lang\/lucent\/metro/.test(text) ? ok("metro", "Metro config", `${path.basename(file)} uses withLucent`) : fail("metro", "Metro config", `${path.basename(file)} does not use withLucent from @lucent-lang/lucent/metro, so Metro bundles *.lucent.ts as TypeScript`, fix);
}

function tsconfig(root: string): Check {
  const text = read(path.join(root, "tsconfig.json"));
  if (text === undefined) return skip("tsconfig", "tsconfig paths", "no tsconfig.json");
  return text.includes('"lucent:*"') ? ok("tsconfig", "tsconfig paths", "lucent:* mapped") : warn("tsconfig", "tsconfig paths", "lucent:* is not mapped, so editors cannot resolve lucent:core or the SDK modules", "run lucent build (or lucent init): it maps lucent:* in tsconfig.json");
}

function sdkCache(probe: Probe): Check {
  const dir = probe.env.LUCENT_CACHE_DIR || path.join(probe.env.XDG_CACHE_HOME || path.join(probe.home, ".cache"), "lucent");
  const sdk = path.join(dir, "sdk");
  if (!fs.existsSync(sdk)) return ok("sdk-cache", "SDK cache", `empty (${dir.replace(probe.home, "~")}); lucent sdk prefetch fills it ahead of time`);
  let bytes = 0;
  let modules = 0;
  const walk = (d: string) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const f = path.join(d, e.name);
      if (e.isDirectory()) walk(f);
      else {
        bytes += fs.statSync(f).size;
        if (e.name.endsWith(".json") && !e.name.endsWith(".names.json")) modules++;
      }
    }
  };
  walk(sdk);
  return ok("sdk-cache", "SDK cache", `${modules} modules, ${(bytes / 1e6).toFixed(0)} MB (${dir.replace(probe.home, "~")})`);
}

function versions(root: string, probe: Probe): Check {
  const app = installed(root, "@lucent-lang/lucent");
  if (app && app !== probe.cliVersion) return fail("versions", "Lucent versions", `the app has @lucent-lang/lucent ${app}, this lucent is ${probe.cliVersion}`, "run the app's own lucent (npx lucent …), or install the same version");
  try {
    const packages = lucentPackages(root);
    return ok("versions", "Lucent versions", `${probe.cliVersion}${packages.length ? `; ${packages.length} Lucent package${packages.length === 1 ? "" : "s"} compatible` : ""}`);
  } catch (e) {
    return fail("versions", "Lucent versions", (e as Error).message, "update the Lucent package or @lucent-lang/lucent so their versions match");
  }
}
