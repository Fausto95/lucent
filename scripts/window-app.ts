/**
 * A fresh app on a release Lucent supports, built with the packed package,
 * as someone starting one would: a bare app from React Native's own
 * template for that release (the Community CLI's init), or an Expo app
 * from create-expo-app's template for that SDK. It installs the packed
 * @lucent-lang/lucent, runs `lucent init --yes`, adds a module of each
 * kind `lucent new module` scaffolds and a component (`lucent new view`),
 * checks the release with `lucent doctor`, then builds: `lucent build`,
 * and the platform's own build (xcodebuild for the iOS simulator, Gradle's
 * assembleDebug). It builds the app; it does not run it.
 *
 *   node scripts/window-app.ts --app bare --release 0.86 --platform android [--dir path] [--no-native]
 *   node scripts/window-app.ts --matrix
 *
 * `--release` is a React Native minor for a bare app, an Expo SDK for an
 * Expo app; `--no-native` stops before the platform build. `--matrix`
 * prints the window's apps (decisions 0074 and 0079), bare and Expo, for
 * each platform, as the matrix CI's window.yml builds nightly.
 */
import { execFileSync } from "node:child_process";
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
        "LucentWindow",
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

  return (
    JSON.parse(fs.readFileSync(path.join(dir, "package.json"), "utf8")) as {
      dependencies: Record<string, string>;
    }
  ).dependencies["react-native"]!;
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
  if (app === "expo") sh("npx", ["expo", "prebuild", "--platform", platform, "--no-install"], dir);

  if (platform === "ios") {
    const ios = path.join(dir, "ios");
    // lucent build reads the pods' headers, and pod install links what it writes.
    sh("pod", ["install"], ios);
    sh("npx", ["lucent", "build", "--platforms", "ios"], dir);
    sh("pod", ["install"], ios);
    const name = workspace(ios);
    sh(
      "xcodebuild",
      [
        "-workspace",
        `${name}.xcworkspace`,
        "-scheme",
        name,
        "-configuration",
        "Debug",
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
      ["assembleDebug", "-PreactNativeArchitectures=x86_64", "--no-daemon"],
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
      "usage: node scripts/window-app.ts --app bare|expo --release <minor|sdk> --platform ios|android [--dir path] [--no-native]",
    );
    process.exit(2);
  }

  const work = fs.mkdtempSync(path.join(os.tmpdir(), "lucent-window-"));
  const dir = path.resolve(values.dir ?? path.join(work, "app"));
  fs.rmSync(dir, { recursive: true, force: true });

  const tarball = pack(work);
  const reactNative = create(app, values.release, dir);
  console.log(`• ${app} app on React Native ${reactNative}: ${dir}`);

  sh("npm", ["install", "--no-audit", "--no-fund", "--loglevel=error"], dir);
  sh("npm", ["install", "--no-audit", "--no-fund", "--loglevel=error", "-D", tarball], dir);
  sh("npx", ["lucent", "init", "--yes"], dir);
  for (const [name, template] of [
    ["counter", "events"],
    ["device", "sdk-ios-android"],
  ] as const)
    sh("npx", ["lucent", "new", "module", name, "--template", template], dir);
  sh("npx", ["lucent", "new", "view", "Badge"], dir);
  checkReleases(dir, app);

  if (!values["no-native"]) buildNative(dir, app, platform);
  console.log(
    values["no-native"]
      ? `✓ the ${app} app on ${values.release} is set up (${dir})`
      : `✓ the ${app} app on ${values.release} builds for ${platform} (${dir})`,
  );
}
