/**
 * A fresh app on a release Lucent supports, built with the packed package,
 * as someone starting one would: a bare app from React Native's own
 * template for that release (the Community CLI's init), or an Expo app
 * from create-expo-app's template for that SDK. It installs the packed
 * @lucent-lang/lucent, runs `lucent init --yes`, adds a module of each
 * kind `lucent new module` scaffolds and a component (`lucent new view`),
 * and an App.tsx that checks them, checks the release with `lucent
 * doctor`, then builds: `lucent build`, and the platform's own Release
 * build (xcodebuild for the iOS simulator, Gradle's assembleRelease).
 *
 * `--check` then runs the built app (scripts/device-check.ts): on the iOS
 * simulator it boots, or on the Android emulator already running. The app
 * calls the scaffolded modules, mounts the components, asks one for an
 * answer through its ref, and logs its verdict as the bare example's Tests
 * screen does.
 *
 *   node scripts/window-app.ts --app bare --release 0.86 --platform android [--dir path] [--no-native]
 *   node scripts/window-app.ts --app bare --release 0.86 --platform android --dir path --check
 *   node scripts/window-app.ts --matrix
 *
 * `--release` is a React Native minor for a bare app, an Expo SDK for an
 * Expo app; `--no-native` stops before the platform build. `--matrix`
 * prints the window's apps (decisions 0074 and 0079), bare and Expo, for
 * each platform, as the matrix CI's window.yml builds and runs nightly.
 */
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { REQUIREMENTS } from "../packages/lucent/src/cli/doctor.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

type AppKind = "bare" | "expo";
type Platform = "ios" | "android";

export interface WindowApp {
  name: string;
  app: AppKind;
  release: string;
  platform: Platform;
  /** The runner CI builds it on. */
  runner: string;
}

/** Each app of the window: bare on each React Native release, Expo on each SDK, on each platform. */
export function windowApps(): WindowApp[] {
  const releases: [AppKind, string][] = [
    ...REQUIREMENTS.reactNative.window.map((r): [AppKind, string] => ["bare", r]),
    ...REQUIREMENTS.expoSdk.window.map((sdk): [AppKind, string] => ["expo", String(sdk)]),
  ];

  return releases.flatMap(([app, release]) =>
    (["ios", "android"] as const).map((platform) => ({
      name: `${app === "bare" ? `React Native ${release}` : `Expo SDK ${release}`} (${platform === "ios" ? "iOS simulator" : "Android"})`,
      app,
      release,
      platform,
      runner: platform === "ios" ? "macos-26" : "ubuntu-latest",
    })),
  );
}

/** The app's name, which its iOS project, scheme and executable take. */
export const APP_NAME = "LucentWindow";

/** What the fresh app is called on each platform, and where its Release build is. */
export function appIdentity(
  app: AppKind,
  dir: string,
): { iosId: string; androidId: string; process: string; ios: string; android: string } {
  return {
    // The Community CLI's template names them after the app; an Expo app takes app.json's.
    iosId: app === "bare" ? `org.reactjs.native.example.${APP_NAME}` : "dev.lucent.window",
    androidId: app === "bare" ? `com.${APP_NAME.toLowerCase()}` : "dev.lucent.window",
    process: APP_NAME,
    ios: path.join(dir, "ios/build/Build/Products/Release-iphonesimulator", `${APP_NAME}.app`),
    android: path.join(dir, "android/app/build/outputs/apk/release/app-release.apk"),
  };
}

/** The pod a Lucent package of the app declares (packageFiles), which binds once installed. */
export const PACKAGE_POD = "LucentWindowKit";

/**
 * A Lucent package the app depends on, as one from npm would be, whose
 * lucent.json declares a pod: an Objective-C class whose module its iOS
 * code imports. The pod is local, and the app's Podfile installs it from
 * its path (podLine). An Expo app's prebuild leaves iOS unbound until pod
 * install installs it; the Podfile's Lucent hook binds it then.
 */
export function packageFiles(): Record<string, string> {
  return {
    "packages/lucent-window-kit/package.json": `${JSON.stringify(
      { name: "lucent-window-kit", version: "1.0.0", lucent: { sources: "src" } },
      null,
      2,
    )}\n`,
    "packages/lucent-window-kit/lucent.json": `${JSON.stringify({ ios: { pods: { [PACKAGE_POD]: "~> 1.0" } } }, null, 2)}\n`,
    "packages/lucent-window-kit/src/kit.lucent.ts": `// What the package's pod answers on iOS, through the module its Objective-C class is in.
import { PLATFORM } from "lucent:platform";
import { LWKAnswer } from "lucent:ios/${PACKAGE_POD}";

export function kitAnswer(): number {
  if (PLATFORM === "ios") return LWKAnswer.answer();
  return 42;
}
`,
    [`pods/${PACKAGE_POD}/${PACKAGE_POD}.podspec`]: `Pod::Spec.new do |s|
  s.name = "${PACKAGE_POD}"
  s.version = "1.0.0"
  s.summary = "The pod a Lucent package of the window check declares"
  s.homepage = "https://github.com/Fausto95/lucent"
  s.license = "MIT"
  s.authors = "Lucent"
  s.source = { :git => "https://github.com/Fausto95/lucent.git", :tag => s.version.to_s }
  s.platforms = { :ios => "15.1" }
  s.source_files = "LWKAnswer.{h,m}"
  s.public_header_files = "LWKAnswer.h"
  s.pod_target_xcconfig = { "DEFINES_MODULE" => "YES" }
end
`,
    [`pods/${PACKAGE_POD}/LWKAnswer.h`]: `#import <Foundation/Foundation.h>

@interface LWKAnswer : NSObject
+ (NSInteger)answer;
@end
`,
    [`pods/${PACKAGE_POD}/LWKAnswer.m`]: `#import "LWKAnswer.h"

@implementation LWKAnswer
+ (NSInteger)answer {
  return 42;
}
@end
`,
  };
}

/** The Podfile with the package's pod installed from its path, in the app's target. */
export function podLine(podfile: string): string {
  const line = `  pod '${PACKAGE_POD}', :path => '../pods/${PACKAGE_POD}'`;
  const target = /^target ['"][^'"]+['"] do$/m.exec(podfile);
  if (!target) throw new Error("the Podfile has no app target");
  if (podfile.includes(line)) return podfile;
  const at = target.index + target[0].length;

  return `${podfile.slice(0, at)}\n${line}${podfile.slice(at)}`;
}

/**
 * The files the app's check adds: a module that logs where device-check.ts
 * reads (Lucent's console goes to os_log and logcat's Lucent tag), a
 * component that answers through its ref once mounted, and an App.tsx
 * that calls the scaffolded modules, renders both components and logs a
 * verdict: LUCENT_PROGRESS after each check, LUCENT_SUMMARY at the end.
 */
export function checkFiles(): Record<string, string> {
  return {
    "src/window-check.lucent.ts": `// Lines the window check reads from the device log.
export function report(line: string): void {
  console.log(line);
}
`,
    "src/window-probe.lucent.tsx": `// A component the window check mounts; ping() answers through its ref once it is on screen.
import { PLATFORM } from "lucent:platform";
import { appContext } from "lucent:android";
import { TextView } from "lucent:android/android.widget";
import { UILabel } from "lucent:ios/UIKit";
import { effect, expose } from "lucent:ui";

export function WindowProbe(props: { label: string }) {
  expose({ ping: (): string => "pong" });

  if (PLATFORM === "ios") {
    const label = new UILabel();
    effect(() => {
      label.text = props.label;
    });
    return label;
  }

  const text = new TextView(appContext());
  effect(() => text.setText(props.label));
  return text;
}
`,
    "App.tsx": `// The window check (scripts/window-app.ts): calls the scaffolded modules, mounts the
// components, and logs a verdict as the bare example's Tests screen does.
import { useEffect, useRef, useState } from "react";
import { SafeAreaView, Text } from "react-native";
import { Badge } from "lucent:views/badge";
import { start, watch } from "./src/counter.lucent";
import { hello } from "./src/device.lucent";
import { report } from "./src/window-check.lucent";
import { kitAnswer } from "lucent-window-kit/src/kit.lucent";
import { WindowProbe } from "./src/window-probe.lucent";

type Probe = { ping(): Promise<string> };

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function events(): Promise<boolean> {
  const controller = new AbortController();
  let ticks = 0;
  const watching = watch(() => {
    ticks++;
  }, controller.signal);
  await start(3, 20);
  for (let i = 0; i < 50 && ticks < 3; i++) await sleep(100);
  controller.abort();
  await watching.catch(() => undefined);
  return ticks === 3;
}

async function mounted(probe: { current: Probe | null }): Promise<boolean> {
  for (let i = 0; i < 150; i++) {
    try {
      if (probe.current && (await probe.current.ping()) === "pong") return true;
    } catch {
      // Not mounted yet.
    }
    await sleep(200);
  }
  return false;
}

export default function App() {
  const probe = useRef<Probe>(null);
  const [status, setStatus] = useState("checking");

  useEffect(() => {
    const checks: [string, () => Promise<boolean>][] = [
      ["platform-module", async () => (await hello("window")).startsWith("Hello, window")],
      ["events-module", events],
      ["component", () => mounted(probe)],
      ["package-pod", async () => kitAnswer() === 42],
    ];
    void (async () => {
      let passed = 0;
      report(\`LUCENT_PROGRESS tests 0/\${checks.length} started\`);
      for (const [i, [name, check]] of checks.entries()) {
        let ok = false;
        try {
          ok = await check();
        } catch (e) {
          report(\`LUCENT_ERROR \${name}: \${String(e)}\`);
        }
        if (ok) passed++;
        report(\`LUCENT_PROGRESS tests \${i + 1}/\${checks.length} \${name} \${ok ? "ok" : "FAILED"}\`);
      }
      report(\`LUCENT_SUMMARY tests \${passed}/\${checks.length} passed\`);
      setStatus(\`\${passed}/\${checks.length} passed\`);
    })();
  }, []);

  return (
    <SafeAreaView style={{ flex: 1, padding: 24, gap: 12 }}>
      <Text>Lucent window check: {status}</Text>
      <Badge title="A component from lucent new view" />
      <WindowProbe ref={probe} label="A component the check asks" />
    </SafeAreaView>
  );
}
`,
  };
}

function sh(cmd: string, args: string[], cwd: string, env: NodeJS.ProcessEnv = {}): string {
  console.log(`$ ${cmd} ${args.join(" ")}`);

  try {
    return execFileSync(cmd, args, {
      cwd,
      env: { ...process.env, CI: "1", ...env },
      encoding: "utf8",
      stdio: ["ignore", "pipe", "inherit"],
      maxBuffer: 256 << 20,
    });
  } catch (e) {
    // The end of what the command printed, last: CI's annotation keeps the output's end.
    const out = (e as { stdout?: string }).stdout ?? "";
    process.stderr.write(`${out.slice(-12_000)}\n✗ ${cmd} ${args.join(" ")} failed in ${cwd}\n`);
    process.exit(1);
  }
}

/** The newest version npm has of `pkg` matching `range`. */
function newest(pkg: string, range: string): string {
  const found = JSON.parse(
    execFileSync("npm", ["view", `${pkg}@${range}`, "version", "--json"], { encoding: "utf8" }),
  ) as string | string[];
  const version = Array.isArray(found) ? found.at(-1) : found;
  if (!version) throw new Error(`npm has no ${pkg} matching ${range}`);

  return version;
}

/** The packed @lucent-lang/lucent, as npm installs it (pnpm build first). */
function pack(into: string): string {
  const out = sh("pnpm", ["pack", "--pack-destination", into], path.join(root, "packages/lucent"))
    .trim()
    .split("\n")
    .pop()!;

  return path.isAbsolute(out) ? out : path.join(into, path.basename(out));
}

/** Makes the app at `dir` from its release's template; its React Native version. */
function create(app: AppKind, release: string, dir: string): string {
  const parent = path.dirname(dir);
  fs.mkdirSync(parent, { recursive: true });

  if (app === "bare") {
    const version = newest("react-native", release);
    sh(
      "npx",
      [
        "--yes",
        "@react-native-community/cli@latest",
        "init",
        APP_NAME,
        "--version",
        version,
        "--directory",
        dir,
        "--skip-install",
        "--skip-git-init",
        "--install-pods",
        "false",
      ],
      parent,
    );
  } else {
    sh(
      "npx",
      [
        "--yes",
        "create-expo-app@latest",
        dir,
        "--template",
        `blank-typescript@sdk-${release}`,
        "--no-install",
      ],
      parent,
    );
  }

  if (app === "expo") nameExpoApp(dir);

  return (
    JSON.parse(fs.readFileSync(path.join(dir, "package.json"), "utf8")) as {
      dependencies: Record<string, string>;
    }
  ).dependencies["react-native"]!;
}

/** Names an Expo app as appIdentity says, so prebuild's projects and ids are known. */
function nameExpoApp(dir: string): void {
  const file = path.join(dir, "app.json");
  const config = JSON.parse(fs.readFileSync(file, "utf8")) as {
    expo: { name?: string; ios?: Record<string, unknown>; android?: Record<string, unknown> };
  };
  const ids = appIdentity("expo", dir);
  config.expo.name = APP_NAME;
  config.expo.ios = { ...config.expo.ios, bundleIdentifier: ids.iosId };
  config.expo.android = { ...config.expo.android, package: ids.androidId };
  fs.writeFileSync(file, `${JSON.stringify(config, null, 2)}\n`);
}

/** The checks of `lucent doctor --json` that say whether Lucent supports the app's releases. */
function checkReleases(dir: string, app: AppKind): void {
  // doctor exits non-zero for a machine without an SDK; the releases are what this asks.
  let out: string;
  try {
    out = execFileSync("npx", ["lucent", "doctor", "--json"], { cwd: dir, encoding: "utf8" });
  } catch (e) {
    out = (e as { stdout?: string }).stdout ?? "";
  }

  const checks = (JSON.parse(out) as { checks: { id: string; status: string; detail: string }[] })
    .checks;
  for (const id of app === "expo" ? ["react-native", "expo"] : ["react-native"]) {
    const check = checks.find((c) => c.id === id);
    console.log(`• doctor ${id}: ${check?.status} (${check?.detail})`);
    if (check?.status !== "ok") throw new Error(`lucent doctor's ${id} check: ${check?.detail}`);
  }
}

/** The app's iOS workspace: its name is its scheme's. */
function workspace(ios: string): string {
  const found = fs.readdirSync(ios).find((f) => f.endsWith(".xcworkspace"));
  if (!found) throw new Error(`no .xcworkspace in ${ios}`);

  return found.slice(0, -".xcworkspace".length);
}

function buildNative(dir: string, app: AppKind, platform: Platform): void {
  // Prebuild leaves iOS unbound, the package's pod not being installed yet.
  if (app === "expo") sh("npx", ["expo", "prebuild", "--platform", platform, "--no-install"], dir);

  if (platform === "ios") {
    const ios = path.join(dir, "ios");
    const podfile = path.join(ios, "Podfile");
    fs.writeFileSync(podfile, podLine(fs.readFileSync(podfile, "utf8")));
    if (app === "expo") {
      // As the app's developer would: pod install, whose Lucent hook binds the package's pod once
      // installed, then Xcode's build, whose Lucent phase builds the modules first.
      sh("pod", ["install"], ios);
    } else {
      // A bare app's Podfile has no Lucent hook: lucent build binds the pods pod install
      // installed, and pod install links what it writes.
      sh("pod", ["install"], ios);
      sh("npx", ["lucent", "build", "--platforms", "ios"], dir);
      sh("pod", ["install"], ios);
    }
    const name = workspace(ios);
    sh(
      "xcodebuild",
      [
        "-workspace",
        `${name}.xcworkspace`,
        "-scheme",
        name,
        "-configuration",
        "Release",
        "-sdk",
        "iphonesimulator",
        "-destination",
        "generic/platform=iOS Simulator",
        "-derivedDataPath",
        "build",
        "CODE_SIGNING_ALLOWED=NO",
        "build",
      ],
      ios,
    );
  } else {
    sh("npx", ["lucent", "build", "--platforms", "android"], dir);
    sh(
      "./gradlew",
      ["assembleRelease", "-PreactNativeArchitectures=x86_64", "--no-daemon"],
      path.join(dir, "android"),
    );
  }
}

if (import.meta.main) {
  const { values } = parseArgs({
    options: {
      app: { type: "string" },
      release: { type: "string" },
      platform: { type: "string" },
      dir: { type: "string" },
      "no-native": { type: "boolean" },
      check: { type: "boolean" },
      matrix: { type: "boolean" },
    },
  });

  if (values.matrix) {
    console.log(JSON.stringify(windowApps()));
    process.exit(0);
  }

  const app = values.app as AppKind;
  const platform = values.platform as Platform;
  if (
    !["bare", "expo"].includes(app) ||
    !["ios", "android"].includes(platform) ||
    !values.release
  ) {
    console.error(
      "usage: node scripts/window-app.ts --app bare|expo --release <minor|sdk> --platform ios|android [--dir path] [--no-native | --check]",
    );
    process.exit(2);
  }

  if (values.check) {
    if (!values.dir) {
      console.error("--check runs the app an earlier run built in --dir");
      process.exit(2);
    }
    const ids = appIdentity(app, path.resolve(values.dir));
    const args =
      platform === "ios"
        ? ["ios", "--app", ids.ios, "--id", ids.iosId, "--process", ids.process]
        : ["android", "--apk", ids.android, "--id", ids.androidId, "--process", ids.process];
    // A Release build carries its bundle: no Metro.
    const run = spawnSync(
      process.execPath,
      [path.join(root, "scripts/device-check.ts"), ...args, "--no-metro"],
      { stdio: "inherit" },
    );
    process.exit(run.status ?? 1);
  }

  const work = fs.mkdtempSync(path.join(os.tmpdir(), "lucent-window-"));
  const dir = path.resolve(values.dir ?? path.join(work, "app"));
  fs.rmSync(dir, { recursive: true, force: true });

  const tarball = pack(work);
  const reactNative = create(app, values.release, dir);
  console.log(`• ${app} app on React Native ${reactNative}: ${dir}`);

  sh("npm", ["install", "--no-audit", "--no-fund", "--loglevel=error"], dir);
  sh("npm", ["install", "--no-audit", "--no-fund", "--loglevel=error", "-D", tarball], dir);
  for (const [file, text] of Object.entries(packageFiles())) {
    fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
    fs.writeFileSync(path.join(dir, file), text);
  }
  sh(
    "npm",
    ["install", "--no-audit", "--no-fund", "--loglevel=error", "./packages/lucent-window-kit"],
    dir,
  );
  sh("npx", ["lucent", "init", "--yes"], dir);
  for (const [name, template] of [
    ["counter", "events"],
    ["device", "sdk-ios-android"],
  ] as const)
    sh("npx", ["lucent", "new", "module", name, "--template", template], dir);
  sh("npx", ["lucent", "new", "view", "Badge"], dir);
  for (const [file, text] of Object.entries(checkFiles())) {
    fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
    fs.writeFileSync(path.join(dir, file), text);
  }
  checkReleases(dir, app);

  if (!values["no-native"]) buildNative(dir, app, platform);
  console.log(
    values["no-native"]
      ? `✓ the ${app} app on ${values.release} is set up (${dir})`
      : `✓ the ${app} app on ${values.release} builds for ${platform} (${dir})`,
  );
}
