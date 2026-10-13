import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { androidSdkCandidates } from "./sdks.ts";
import { ignoreCompatible, incompatibility, lucentPackages } from "@lucent-lang/compiler/packages";
import { buildChecks } from "./doctor-build.ts";
import {
  APP_FORWARDS,
  appDelegates,
  missingForwards,
  SCENE_FORWARDS,
} from "./init/app-delegate.ts";
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

const read = (file: string): string | undefined =>
  fs.existsSync(file) ? fs.readFileSync(file, "utf8") : undefined;
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

const ok = (id: string, label: string, detail: string): Check => ({
  id,
  label,
  status: "ok",
  detail,
});
const fail = (id: string, label: string, detail: string, fix: string): Check => ({
  id,
  label,
  status: "fail",
  detail,
  fix,
});
const warn = (id: string, label: string, detail: string, fix: string): Check => ({
  id,
  label,
  status: "warn",
  detail,
  fix,
});
const skip = (id: string, label: string, detail: string): Check => ({
  id,
  label,
  status: "skip",
  detail,
});

/** Every check, in the order doctor prints them. */
export function diagnose(root: string, probe: Probe): Check[] {
  const pkg =
    json<{ dependencies?: Record<string, string>; devDependencies?: Record<string, string> }>(
      path.join(root, "package.json"),
    ) ?? {};
  const deps = { ...pkg.dependencies, ...pkg.devDependencies };
  const expo = "expo" in deps;
  const mac = probe.platform === "darwin";
  return [
    node(probe),
    packageManager(root),
    reactNative(root),
    expo ? expoSdk(root) : skip("expo", "Expo SDK", "not an Expo app"),
    ...(mac
      ? [xcode(probe), simulator(probe), cocoapods(probe)]
      : [skip("xcode", "Xcode", "iOS builds need a Mac")]),
    ...android(probe),
    jdk(probe),
    gradleTask(root, expo),
    appDelegateForwards(root, expo),
    autolinking(root, expo),
    metro(root),
    tsconfig(root),
    sdkCache(probe),
    versions(root, probe),
    ...buildChecks(root, probe),
  ];
}

/**
 * What Lucent needs, as doctor checks it. The website's compatibility page is generated from it.
 * React Native and Expo: the stable releases Lucent supports, its window, and the release on its
 * prerelease lane, where the example apps run (decisions 0074 and 0079). The window moves when a
 * stable release ships: it joins, the oldest leaves, and the lane moves to the next candidate.
 */
export const REQUIREMENTS = {
  node: "22.12",
  reactNative: { window: ["0.85", "0.86", "0.87"], prerelease: "0.88" },
  expoSdk: { window: [56, 57], prerelease: 58 },
  jdk: { min: 17, max: 21 },
} as const;

/** Where a release falls: in the window, on the prerelease lane, or before or after both. */
type Lane = "window" | "prerelease" | "older" | "newer";

function laneOf(release: number[], window: readonly number[][], prerelease: number[]): Lane {
  const compare = (a: number[], b: number[]) => {
    for (let i = 0; i < Math.max(a.length, b.length); i++)
      if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) - (b[i] ?? 0);
    return 0;
  };
  if (window.some((w) => compare(release, w) === 0)) return "window";
  if (compare(release, prerelease) === 0) return "prerelease";
  return compare(release, window[0]!) < 0 ? "older" : "newer";
}

/** A React Native version's lane: by its minor (0.88.0-rc.4 is 0.88's). */
export function reactNativeLane(version: string): Lane {
  const { window, prerelease } = REQUIREMENTS.reactNative;
  const minor = (v: string) => parse(v).slice(0, 2);
  return laneOf(minor(version), window.map(minor), minor(prerelease));
}

/** An Expo package version's lane: by its SDK, its major version. */
export function expoLane(version: string): Lane {
  const { window, prerelease } = REQUIREMENTS.expoSdk;
  return laneOf(
    [parse(version)[0]!],
    window.map((sdk) => [sdk]),
    [prerelease],
  );
}

const span = (from: string, to: string) => (from === to ? from : `${from} to ${to}`);
/** "0.85 to 0.87, and 0.88 on its prerelease lane". */
const reactNativeSupport = () => {
  const { window, prerelease } = REQUIREMENTS.reactNative;
  return `${span(window[0], window.at(-1)!)}, and ${prerelease} on its prerelease lane`;
};
const expoSupport = () => {
  const { window, prerelease } = REQUIREMENTS.expoSdk;
  return `SDK ${window.join(" and ")}, and SDK ${prerelease} on its prerelease lane`;
};

function node(probe: Probe): Check {
  const need = REQUIREMENTS.node;
  return atLeast(probe.nodeVersion, `${need}.0`)
    ? ok("node", "Node.js", probe.nodeVersion)
    : fail(
        "node",
        "Node.js",
        `${probe.nodeVersion}; Lucent needs ${need} or later`,
        `install Node.js ${need} or later (nodejs.org, or your version manager)`,
      );
}

function packageManager(root: string): Check {
  const pm = packageManagerOf(root);
  if (!pm)
    return warn(
      "package-manager",
      "Package manager",
      "no lockfile",
      "install the app's dependencies (npm install, pnpm install, …)",
    );
  return ok(
    "package-manager",
    "Package manager",
    `${pm.name} (${path.relative(root, pm.lockfile)})`,
  );
}

export function reactNative(root: string): Check {
  const v = installed(root, "react-native");
  const newest = REQUIREMENTS.reactNative.window.at(-1)!;
  if (!v)
    return fail(
      "react-native",
      "React Native",
      "not installed",
      `install react-native ${newest} in the app`,
    );
  switch (reactNativeLane(v)) {
    case "window":
      return ok("react-native", "React Native", `${v}, a stable release Lucent supports`);
    case "prerelease":
      return ok("react-native", "React Native", `${v}, on Lucent's prerelease lane`);
    case "older":
      return fail(
        "react-native",
        "React Native",
        `${v}; Lucent supports ${reactNativeSupport()}`,
        `upgrade react-native to ${newest}`,
      );
    case "newer":
      return warn(
        "react-native",
        "React Native",
        `${v}; newer than Lucent supports (${reactNativeSupport()})`,
        `use react-native ${newest}, or a Lucent release that supports ${parse(v).slice(0, 2).join(".")}`,
      );
  }
}

export function expoSdk(root: string): Check {
  const v = installed(root, "expo");
  if (!v)
    return fail(
      "expo",
      "Expo SDK",
      "expo is a dependency but is not installed",
      "install the app's dependencies",
    );
  const sdk = parse(v)[0];
  const newest = REQUIREMENTS.expoSdk.window.at(-1)!;
  switch (expoLane(v)) {
    case "window":
      return ok("expo", "Expo SDK", `${sdk} (expo ${v}), a stable SDK Lucent supports`);
    case "prerelease":
      return ok("expo", "Expo SDK", `${sdk} (expo ${v}), on Lucent's prerelease lane`);
    case "older":
      return fail(
        "expo",
        "Expo SDK",
        `expo ${v}; Lucent supports ${expoSupport()}`,
        `upgrade to Expo SDK ${newest} (npx expo install expo@^${newest}.0.0 --fix)`,
      );
    case "newer":
      return warn(
        "expo",
        "Expo SDK",
        `expo ${v}; newer than Lucent supports (${expoSupport()})`,
        `use Expo SDK ${newest}, or a Lucent release that supports SDK ${sdk}`,
      );
  }
}

function xcode(probe: Probe): Check {
  const r = probe.run("xcodebuild", ["-version"]);
  if (r.status !== 0)
    return fail(
      "xcode",
      "Xcode",
      "not found",
      "install Xcode from the App Store, then: sudo xcode-select -s /Applications/Xcode.app",
    );
  return ok("xcode", "Xcode", r.stdout.split("\n")[0]!.replace(/^Xcode /, ""));
}

function simulator(probe: Probe): Check {
  const r = probe.run("xcrun", ["simctl", "list", "runtimes", "--json"]);
  const runtimes =
    r.status === 0
      ? ((
          JSON.parse(r.stdout) as {
            runtimes?: { name: string; platform?: string; isAvailable?: boolean }[];
          }
        ).runtimes ?? [])
      : [];
  const ios = runtimes.filter(
    (rt) => rt.isAvailable !== false && (rt.platform === "iOS" || rt.name.startsWith("iOS")),
  );
  return ios.length
    ? ok("simulator", "iOS simulator runtime", ios.map((rt) => rt.name).join(", "))
    : warn(
        "simulator",
        "iOS simulator runtime",
        "none installed",
        "install one in Xcode: Settings > Components",
      );
}

function cocoapods(probe: Probe): Check {
  const r = probe.run("pod", ["--version"]);
  return r.status === 0
    ? ok("cocoapods", "CocoaPods", r.stdout.trim())
    : fail(
        "cocoapods",
        "CocoaPods",
        "not installed",
        "brew install cocoapods (or: sudo gem install cocoapods)",
      );
}

function android(probe: Probe): Check[] {
  const candidates = androidSdkCandidates(probe.platform, probe.home, probe.env);
  const sdk = candidates.find((d) => fs.existsSync(path.join(d, "platforms")));
  if (!sdk) {
    return [
      fail(
        "android-sdk",
        "Android SDK",
        "not found",
        `install Android Studio (or the command-line tools), then set ANDROID_HOME to the SDK (${probe.platform === "win32" ? "%LOCALAPPDATA%\\Android\\Sdk" : probe.platform === "darwin" ? "~/Library/Android/sdk" : "~/Android/Sdk"} by default)`,
      ),
      skip("ndk", "Android NDK", "needs the Android SDK"),
    ];
  }
  const platforms = fs
    .readdirSync(path.join(sdk, "platforms"))
    .filter((p) => /^android-\d+/.test(p))
    .sort((a, b) => Number(b.slice(8)) - Number(a.slice(8)));
  const sdkCheck = platforms.length
    ? ok("android-sdk", "Android SDK", `${platforms[0]} at ${sdk.replace(probe.home, "~")}`)
    : fail(
        "android-sdk",
        "Android SDK",
        `no platform installed at ${sdk}`,
        "install one with Android Studio's SDK Manager, or: sdkmanager 'platforms;android-36'",
      );
  const envSet = probe.env.ANDROID_HOME || probe.env.ANDROID_SDK_ROOT;
  const ndks = fs.existsSync(path.join(sdk, "ndk"))
    ? fs.readdirSync(path.join(sdk, "ndk")).sort()
    : [];
  const ndkCheck = ndks.length
    ? ok("ndk", "Android NDK", ndks.at(-1)!)
    : fail(
        "ndk",
        "Android NDK",
        "not installed",
        "install it with Android Studio's SDK Manager (SDK Tools > NDK), or: sdkmanager 'ndk;27.1.12297006'",
      );
  if (sdkCheck.status === "ok" && !envSet)
    return [
      {
        ...sdkCheck,
        status: "warn",
        fix:
          probe.platform === "win32"
            ? `setx ANDROID_HOME "${sdk}" (Gradle and adb find the SDK through it)`
            : `export ANDROID_HOME=${sdk.replace(probe.home, "$HOME")} (Gradle and adb find the SDK through it)`,
      },
      ndkCheck,
    ];
  return [sdkCheck, ndkCheck];
}

function jdk(probe: Probe): Check {
  const r = probe.run("java", ["-version"]);
  const { min, max } = REQUIREMENTS.jdk;
  if (r.status !== 0)
    return fail(
      "jdk",
      "JDK",
      "not found",
      `install JDK ${min} or ${max} (e.g. brew install --cask zulu@${max}) and set JAVA_HOME`,
    );
  const m = /version "(\d+)(?:\.(\d+))?/.exec(r.stderr + r.stdout);
  const major = m ? Number(m[1] === "1" ? m[2] : m[1]) : 0;
  if (major >= min && major <= max) return ok("jdk", "JDK", String(major));
  return warn(
    "jdk",
    "JDK",
    `${major || "unknown version"}; React Native's Gradle build needs ${min} to ${max}`,
    `set JAVA_HOME to JDK ${min} or ${max} (macOS: export JAVA_HOME=$(/usr/libexec/java_home -v ${max}))`,
  );
}

/**
 * Whether a bare app's delegates forward what only they receive to Lucent
 * modules: the calls `lucent init` adds (init/app-delegate.ts). An Expo
 * app's subscriber needs none.
 */
function appDelegateForwards(root: string, expo: boolean): Check {
  const label = "App delegate forwarding";
  if (expo) return skip("app-delegate", label, "an Expo app: Lucent's subscriber forwards");
  const { app, scene, objc } = appDelegates(root);
  if (!app && !objc) return skip("app-delegate", label, "no ios/*/AppDelegate");
  if (objc)
    return read(path.join(root, objc))!.includes("LucentAppDelegate")
      ? ok("app-delegate", label, `${objc} calls LucentAppDelegate`)
      : warn(
          "app-delegate",
          label,
          `${objc} doesn't call LucentAppDelegate, so modules hear no URL, user activity or push token`,
          "call it first in each delegate method (lucent init prints the lines)",
        );
  const missing = [
    ...missingForwards(read(path.join(root, app!))!, APP_FORWARDS).map((m) => `AppDelegate ${m}`),
    ...(scene
      ? missingForwards(read(path.join(root, scene))!, SCENE_FORWARDS).map(
          (m) => `SceneDelegate ${m}`,
        )
      : []),
  ];
  return missing.length === 0
    ? ok(
        "app-delegate",
        label,
        `forwards to LucentAppDelegate${scene ? ", with the scene delegate" : ""}`,
      )
    : warn(
        "app-delegate",
        label,
        `not forwarded to Lucent modules: ${missing.join(", ")}`,
        "run lucent init, which adds the calls",
      );
}

function gradleTask(root: string, expo: boolean): Check {
  const file = ["android/app/build.gradle", "android/app/build.gradle.kts"]
    .map((f) => path.join(root, f))
    .find((f) => fs.existsSync(f));
  if (!file)
    return skip(
      "gradle-task",
      "Lucent Gradle task",
      expo ? "no android/ yet (expo prebuild adds it)" : "no android/app/build.gradle",
    );
  const text = read(file)!;
  return /lucent\.gradle/.test(text)
    ? ok("gradle-task", "Lucent Gradle task", "applied in android/app")
    : fail(
        "gradle-task",
        "Lucent Gradle task",
        `${path.relative(root, file)} does not apply it, so Gradle builds may use an old .lucent/native`,
        expo
          ? "run expo prebuild again (the Lucent config plugin adds it), or lucent init"
          : "run lucent init",
      );
}

/**
 * Whether React Native's autolinking links the native package, and builds
 * it first: .lucent/ is ignored by git, so on a fresh clone (CI, EAS) an
 * entry naming the root alone links nothing, without a word, and the app
 * fails when a module loads. iOS links it through the Podfile's
 * use_native_modules!, which reads react-native.config.js.
 */
function autolinking(root: string, expo: boolean): Check {
  const label = "Native package autolinking";
  const text = read(path.join(root, "react-native.config.js"));
  const podfile = read(path.join(root, "ios/Podfile"));

  if (text === undefined)
    return expo &&
      !fs.existsSync(path.join(root, "ios")) &&
      !fs.existsSync(path.join(root, "android"))
      ? skip("autolinking", label, "no native projects yet (expo prebuild links it)")
      : fail(
          "autolinking",
          label,
          "no react-native.config.js, so the app doesn't link .lucent/native",
          expo
            ? "run expo prebuild again (the Lucent config plugin adds it), or lucent init"
            : "run lucent init",
        );
  if (!/@lucent-lang\/lucent\/autolink/.test(text))
    return /["']?lucent["']?\s*:\s*\{\s*root:/.test(text)
      ? warn(
          "autolinking",
          label,
          "react-native.config.js links .lucent/native without building it: on a fresh clone (CI, EAS) pod install and Gradle skip it, and the app fails at run time",
          'run lucent init, which writes "lucent": require("@lucent-lang/lucent/autolink")(__dirname)',
        )
      : fail(
          "autolinking",
          label,
          "react-native.config.js doesn't link .lucent/native",
          'add "lucent": require("@lucent-lang/lucent/autolink")(__dirname) to its dependencies (lucent init does)',
        );
  if (podfile !== undefined && !/use_native_modules!/.test(podfile))
    return fail(
      "autolinking",
      label,
      "ios/Podfile doesn't call use_native_modules!, so pod install doesn't read react-native.config.js",
      "add `config = use_native_modules!` to the app's target, as React Native's template has it",
    );
  return ok(
    "autolinking",
    label,
    `react-native.config.js builds and links .lucent/native${podfile !== undefined ? "; ios/Podfile reads it" : ""}`,
  );
}

function metro(root: string): Check {
  const file = ["metro.config.js", "metro.config.cjs", "metro.config.mjs", "metro.config.ts"]
    .map((f) => path.join(root, f))
    .find((f) => fs.existsSync(f));
  const fix =
    'wrap the config: const { withLucent } = require("@lucent-lang/lucent/metro"); module.exports = withLucent(config);';
  if (!file) return fail("metro", "Metro config", "no metro.config.js", fix);
  const text = read(file)!;
  return /withLucent/.test(text) && /@lucent-lang\/lucent\/metro/.test(text)
    ? ok("metro", "Metro config", `${path.basename(file)} uses withLucent`)
    : fail(
        "metro",
        "Metro config",
        `${path.basename(file)} does not use withLucent from @lucent-lang/lucent/metro, so Metro bundles *.lucent.ts as TypeScript`,
        fix,
      );
}

function tsconfig(root: string): Check {
  const text = read(path.join(root, "tsconfig.json"));
  if (text === undefined) return skip("tsconfig", "tsconfig paths", "no tsconfig.json");
  return text.includes('"lucent:*"')
    ? ok("tsconfig", "tsconfig paths", "lucent:* mapped")
    : warn(
        "tsconfig",
        "tsconfig paths",
        "lucent:* is not mapped, so editors cannot resolve lucent:core or the SDK modules",
        "run lucent build (or lucent init): it maps lucent:* in tsconfig.json",
      );
}

function sdkCache(probe: Probe): Check {
  const dir =
    probe.env.LUCENT_CACHE_DIR ||
    path.join(probe.env.XDG_CACHE_HOME || path.join(probe.home, ".cache"), "lucent");
  const sdk = path.join(dir, "sdk");
  if (!fs.existsSync(sdk))
    return ok(
      "sdk-cache",
      "SDK cache",
      `empty (${dir.replace(probe.home, "~")}); lucent sdk prefetch fills it ahead of time`,
    );
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
  return ok(
    "sdk-cache",
    "SDK cache",
    `${modules} modules, ${(bytes / 1e6).toFixed(0)} MB (${dir.replace(probe.home, "~")})`,
  );
}

function versions(root: string, probe: Probe): Check {
  const app = installed(root, "@lucent-lang/lucent");
  if (app && app !== probe.cliVersion)
    return fail(
      "versions",
      "Lucent versions",
      `the app has @lucent-lang/lucent ${app}, this lucent is ${probe.cliVersion}`,
      "run the app's own lucent (npx lucent …), or install the same version",
    );
  let packages: ReturnType<typeof lucentPackages>;
  try {
    packages = lucentPackages(root);
  } catch (e) {
    return fail(
      "versions",
      "Lucent versions",
      (e as Error).message,
      "fix the package's package.json",
    );
  }
  const incompatible = packages.flatMap((p) => incompatibility(p) ?? []);
  if (incompatible.length)
    return (ignoreCompatible(probe.env) ? warn : fail)(
      "versions",
      "Lucent versions",
      incompatible.join("; "),
      "update the Lucent package or @lucent-lang/lucent so their versions match (LUCENT_IGNORE_COMPATIBLE=1 builds it anyway)",
    );
  return ok(
    "versions",
    "Lucent versions",
    `${probe.cliVersion}${packages.length ? `; ${packages.length} Lucent package${packages.length === 1 ? "" : "s"} compatible` : ""}`,
  );
}
