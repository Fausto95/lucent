/**
 * The view spike on the iOS simulator or an Android emulator: an example
 * app (bare or Expo) whose entry shows the spike's screen
 * (apps/bare-example/.views-spike), with the spike's components' views
 * generated (LUCENT_VIEWS=fabric). Internal: views stay behind that switch
 * until they are proven.
 *
 *   node scripts/views-spike.ts [--app bare|expo] [--platform ios|android]
 *                               [--configuration Release|Debug] [--device <name, udid or serial>]
 *                               [--out <dir>] [--wait <seconds>] [--shots <seconds>,…]
 *                               [--launches <n>] [--android-flags recycling,accumulate]
 *                               [--set-aside <app-relative path>,…] [--skip-build] [--trace]
 *                               [--entry <spike file>] [--trace-sizing] [--font-scale]
 *                               [--tap <x>,<y>@<seconds>;…] [--prebuild]
 *                               [--ui <background|foreground|dark|light>@<seconds>,…]
 *                               [--android-changes <change>@<seconds>,…] [--heap <seconds>,…]
 *
 * For the build, it copies the spike into the app (views-spike/), makes
 * the app's entry import the spike's, and moves the --set-aside modules
 * out (a module whose code the main-thread check cannot tell from the
 * spike's would keep the spike's setups from building); all of it is
 * restored after. It builds the native package, then the app, bundled
 * from the spike's entry: pods and xcodebuild, or Gradle for the
 * emulator's arm64-v8a (without the app's lucentBuild task, which would
 * build the package again). A Debug build bundles its JavaScript too, so
 * it runs without Metro, and its DevSettings.reload() starts JavaScript
 * again: the spike asks for that once its first run is over. An Expo app
 * without its native project is prebuilt first.
 *
 * --entry picks the spike's screen: index.js (the default: components,
 * props, events, commands, recycling, isolation), sizing.js (components
 * sized by their content), toggle.js (a component drawn with the
 * platform's toolkit: its animations, actions and state, while JavaScript
 * is blocked), list.js (a todo list drawn with the toolkit: keyed items,
 * bound fields, transitions, the toolkit's environment), like.js (the
 * documentation's one-file Like button, three of them, for screenshots),
 * or hosting.js
 * (see --ui). --trace-sizing has the runtime
 * log each sizing step (LUCENT_SIZING lines: LUCENT_SIZING_TRACE on iOS,
 * the debug.lucent.sizing property on Android). --font-scale makes the
 * text size the user chose larger: on iOS extra-extra-large 15 s after
 * each launch (the app hears of it live), on Android a font scale of 1.3
 * before the launches (a live change would restart the activity); the
 * device's own size is restored after the launches.
 *
 * --entry toggle.js is the toggle screen: a component whose body is the
 * platform's declarative UI written in Lucent (SwiftUI on iOS, Compose on
 * Android). --tap taps the screen at pixel <x>,<y> that many seconds
 * after launch (Android: adb input), as a user would. --entry
 * lifecycle.js is the lifecycle screen: that component as navigation
 * mounts and unmounts it, in a Modal, and across configuration changes.
 *
 * --android-changes changes the device's configuration that many seconds
 * after each launch, while the app runs, and restores it after the
 * launch: `night` (the dark theme, which React Native's templates handle
 * without recreating the Activity) or `font` (a font scale of 1.3, which
 * they don't: the Activity is recreated). --heap (Android) dumps the
 * app's heap after garbage collections that many seconds after launch,
 * and counts the objects of Lucent's hosts and Compose's views and
 * compositions it holds, and how many of them JNI global references keep
 * (heap-<seconds>s.txt); the dump itself is not kept.
 *
 * --prebuild (Expo) prebuilds the native projects afresh, as the Lucent
 * config plugin does (Android left to Gradle), and lets the app's Gradle
 * build run its lucentBuild task: the path an Expo app takes.
 *
 * --ui changes the app's situation that many seconds after launch (iOS):
 * `background` opens another app, `foreground` brings the spike's back,
 * `dark` and `light` set the device's appearance, which is light again
 * after each launch. --entry hosting.js is the screen for them: toggles in
 * a sheet, a full-screen modal and a right-to-left layout, which it
 * unmounts and mounts again, and a development build reloads.
 *
 * --android-flags turns React Native feature flags on in the Android app
 * for the build: `recycling` (enableViewRecycling), `accumulate`
 * (enableAccumulatedUpdatesInRawPropsAndroid).
 *
 * Then, holding the shared device lock (/tmp/np-sim.lock), it installs
 * the app afresh and launches it `--launches` times (default 2: the
 * second is a runtime restart, a new process), each for `--wait` seconds,
 * and records each launch's LUCENT log lines (launch-<n>/log.txt),
 * screenshots at the `--shots` times (seconds after launch) and at the end
 * (screen.png), and what the log says of the isolation phases
 * (summary.txt). Android needs ANDROID_HOME, adb on PATH and JDK 21
 * (JAVA_HOME).
 *
 * --trace (iOS) launches the app with LUCENT_TRACE=platform and keeps the
 * runtime's signposts (trace.txt): the summary then says which threads
 * waited for the Lucent lock, the main thread (the Pulses' ticks') among
 * them or not.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { countClasses } from "./hprof.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = path.join(root, "apps/bare-example/.views-spike");
const lock = "/tmp/np-sim.lock";

/** What the runner needs to know of each example app. */
const APPS = {
  bare: {
    dir: "apps/bare-example",
    entry: "index.js",
    ios: { workspace: "BareExample.xcworkspace", scheme: "BareExample", product: "BareExample" },
    android: { id: "com.bareexample", application: "com/bareexample/MainApplication.kt" },
  },
  expo: {
    dir: "apps/expo-example",
    entry: "index.ts",
    ios: {
      workspace: "LucentExpoExample.xcworkspace",
      scheme: "LucentExpoExample",
      product: "LucentExpoExample",
    },
    android: {
      id: "dev.lucent.expoexample",
      application: "dev/lucent/expoexample/MainApplication.kt",
    },
  },
} as const;

type Adb = (...args: string[]) => string;

/** The configuration changes --android-changes makes, each giving back how to undo it. */
const ANDROID_CHANGES = {
  night: (adb: Adb) => {
    adb("shell", "cmd", "uimode", "night", "yes");
    return () => void adb("shell", "cmd", "uimode", "night", "no");
  },
  font: (adb: Adb) => {
    const scale = adb("shell", "settings", "get", "system", "font_scale").trim();

    adb("shell", "settings", "put", "system", "font_scale", "1.3");
    return () =>
      void adb(
        "shell",
        "settings",
        "put",
        "system",
        "font_scale",
        scale === "null" ? "1.0" : scale,
      );
  },
} as const;

/** The classes --heap counts: Lucent's hosts, the generated holders, Compose's views and compositions. */
const HEAP_CLASSES = [
  /^dev\.lucent\.LucentHostView$/,
  /^dev\.lucent\.compose\./,
  /^dev\.lucent\.NativeProxy$/,
  /^androidx\.compose\.ui\.platform\.(ComposeView|AndroidComposeView|WrappedComposition)$/,
  /^androidx\.compose\.runtime\.CompositionImpl$/,
];

/** React Native's Android feature flags --android-flags turns on, by name. */
const ANDROID_FLAGS = {
  recycling: "enableViewRecycling",
  accumulate: "enableAccumulatedUpdatesInRawPropsAndroid",
} as const;

const arg = (name: string, fallback: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1]! : fallback;
};

const list = (value: string) => value.split(",").filter(Boolean);

const appName = arg("app", "bare") as keyof typeof APPS;
const spec = APPS[appName];
const app = path.join(root, spec.dir);
const platform = arg("platform", "ios");
const configuration = arg("configuration", "Release");
const variant = configuration.toLowerCase();
const device = arg("device", platform === "android" ? "emulator-5554" : "iPhone 18 Pro");
const out = path.resolve(arg("out", path.join(os.tmpdir(), "lucent-views-spike")));
const wait = Number(arg("wait", "28"));
const shots = list(arg("shots", "")).map(Number);
const taps = arg("tap", "")
  .split(";")
  .filter(Boolean)
  .map((t) => {
    const m = /^(\d+),(\d+)@([\d.]+)$/.exec(t);
    if (!m) throw new Error(`--tap takes <x>,<y>@<seconds>, not ${t}`);
    return { x: Number(m[1]), y: Number(m[2]), at: Number(m[3]) };
  });
const UI_ACTIONS = ["background", "foreground", "dark", "light"] as const;
type UiAction = (typeof UI_ACTIONS)[number];
const uiEvents = list(arg("ui", "")).map((e) => {
  const m = /^(\w+)@([\d.]+)$/.exec(e);
  if (!m || !UI_ACTIONS.includes(m[1] as UiAction))
    throw new Error(`--ui takes <${UI_ACTIONS.join("|")}>@<seconds>, not ${e}`);
  return { action: m[1] as UiAction, at: Number(m[2]) };
});
const launches = Number(arg("launches", "2"));
const flags = list(arg("android-flags", "")).map((f) => {
  if (!(f in ANDROID_FLAGS)) throw new Error(`unknown Android flag ${f}`);
  return ANDROID_FLAGS[f as keyof typeof ANDROID_FLAGS];
});
const changes = list(arg("android-changes", "")).map((c) => {
  const m = /^(\w+)@([\d.]+)$/.exec(c);
  if (!m || !Object.hasOwn(ANDROID_CHANGES, m[1]!))
    throw new Error(
      `--android-changes takes <change>@<seconds>, a change among ${Object.keys(ANDROID_CHANGES).join(", ")}: not ${c}`,
    );
  return { name: m[1] as keyof typeof ANDROID_CHANGES, at: Number(m[2]) };
});
const heaps = list(arg("heap", "")).map(Number);
const prebuild = process.argv.includes("--prebuild");
const setAside = list(arg("set-aside", "")).map((f) => path.join(app, f));
const skipBuild = process.argv.includes("--skip-build");
const entry = arg("entry", "index.js");
const traceSizing = process.argv.includes("--trace-sizing");
const fontScale = process.argv.includes("--font-scale");
/** When --font-scale changes the text size on iOS, after each launch. */
const fontScaleAt = 15;
const trace = process.argv.includes("--trace");
const derived = path.join(os.tmpdir(), `lucent-views-spike-build-${appName}`);
const env = {
  ...process.env,
  LUCENT_VIEWS: "fabric",
  LANG: "en_US.UTF-8",
  LC_ALL: "en_US.UTF-8",
  CI: "1",
};

function sh(cmd: string, args: string[], cwd = root, extra: NodeJS.ProcessEnv = {}): string {
  console.log(`• ${cmd} ${args.join(" ")}`);

  const r = spawnSync(cmd, args, {
    cwd,
    encoding: "utf8",
    maxBuffer: 1 << 30,
    env: { ...env, ...extra },
  });

  if (r.status !== 0)
    throw new Error(`${cmd} failed\n${r.stderr.slice(-4000)}\n${r.stdout.slice(-4000)}`);

  return r.stdout;
}

const sleep = (seconds: number) => new Promise((r) => setTimeout(r, seconds * 1000));

/** Changes files for the build; `restore` puts every one back as it was. */
class Changes {
  private readonly undo: (() => void)[] = [];

  /** Replaces `file`'s text with `edit`'s (a new file if it did not exist). */
  edit(file: string, edit: (text: string) => string): void {
    const before = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : null;
    const after = edit(before ?? "");

    if (after === before) throw new Error(`nothing to change in ${file}`);

    fs.writeFileSync(file, after);
    this.undo.push(() =>
      before === null ? fs.rmSync(file, { force: true }) : fs.writeFileSync(file, before),
    );
  }

  copy(from: string, to: string): void {
    fs.cpSync(from, to, { recursive: true });
    this.undo.push(() => fs.rmSync(to, { recursive: true, force: true }));
  }

  moveAside(file: string): void {
    const to = fs.mkdtempSync(path.join(os.tmpdir(), "lucent-views-spike-aside-"));
    const moved = path.join(to, path.basename(file));

    fs.renameSync(file, moved);
    this.undo.push(() => {
      fs.renameSync(moved, file);
      fs.rmSync(to, { recursive: true, force: true });
    });
  }

  /** Undoes every change, the ones after a failed undo included; throws the first failure. */
  restore(): void {
    const failures: unknown[] = [];

    for (const undo of this.undo.toReversed()) {
      try {
        undo();
      } catch (e) {
        failures.push(e);
      }
    }

    if (failures.length) throw failures[0];
  }
}

/** Kotlin turning `flags` on, after React Native loaded its own. */
function flagsOverride(): string {
  const pkg = "com.facebook.react.internal.featureflags";
  const overrides = [
    // The stable release's own (ReactNativeFeatureFlagsOverrides_RNOSS_Stable_Android, final).
    "useNativeViewConfigsInBridgelessMode",
    "useTurboModuleInterop",
    ...flags,
  ].map((f) => `        override fun ${f}(): Boolean = true`);

  return [
    `    // The views spike's feature flags.`,
    `    ${pkg}.ReactNativeFeatureFlags.dangerouslyForceOverride(`,
    `      object : ${pkg}.ReactNativeNewArchitectureFeatureFlagsDefaults() {`,
    ...overrides,
    `      })`,
  ].join("\n");
}

/** The app with the spike's changes: built, then restored. */
function build(): string {
  const changes = new Changes();

  try {
    changes.copy(source, path.join(app, "views-spike"));
    changes.edit(
      path.join(app, spec.entry),
      () =>
        `// The views spike's entry (scripts/views-spike.ts).\nimport "./views-spike/${entry}";\n`,
    );

    for (const f of setAside) changes.moveAside(f);

    if (appName === "expo" && (prebuild || !fs.existsSync(path.join(app, platform))))
      sh(
        "npx",
        ["expo", "prebuild", ...(prebuild ? ["--clean"] : []), "--platform", platform],
        app,
      );

    // Prebuilt afresh, the app's own build runs lucent build (Gradle's lucentBuild).
    if (!prebuild)
      sh(
        process.execPath,
        [path.join(root, "packages/lucent/bin/lucent.cjs"), "build", "--platforms", platform],
        app,
      );

    return platform === "android" ? buildAndroid(changes) : buildIos(changes);
  } finally {
    changes.restore();
  }
}

function buildIos(changes: Changes): string {
  const ios = path.join(app, "ios");

  sh("pod", ["install"], ios);

  // Expo's bundling phase skips Debug builds unless this file says
  // otherwise; pod install removes it, so it is written after.
  if (appName === "expo" && configuration === "Debug")
    changes.edit(
      path.join(ios, ".xcode.env.updates"),
      () => "unset SKIP_BUNDLING\nexport FORCE_BUNDLING=1\n",
    );
  sh(
    "xcodebuild",
    [
      "-workspace",
      spec.ios.workspace,
      "-scheme",
      spec.ios.scheme,
      "-configuration",
      configuration,
      "-sdk",
      "iphonesimulator",
      "-destination",
      "generic/platform=iOS Simulator",
      "-derivedDataPath",
      derived,
      "build",
    ],
    ios,
    { FORCE_BUNDLING: "1" },
  );

  return iosBundle();
}

const iosBundle = () =>
  path.join(derived, `Build/Products/${configuration}-iphonesimulator/${spec.ios.product}.app`);

const apk = () => path.join(app, `android/app/build/outputs/apk/${variant}/app-${variant}.apk`);

/** The Android app (the emulator's architecture), bundled from the spike's entry. */
function buildAndroid(changes: Changes): string {
  const android = path.join(app, "android");

  if (flags.length)
    changes.edit(path.join(android, "app/src/main/java", spec.android.application), (text) =>
      text.replace(/^\s*loadReactNative\(this\)$/m, (line) => `${line}\n${flagsOverride()}`),
    );

  // A debug build bundles its JavaScript as a release one does.
  if (variant === "debug")
    changes.edit(path.join(android, "app/build.gradle"), (text) =>
      text.replace(/^react \{$/m, "react {\n    debuggableVariants = []"),
    );

  sh(
    "./gradlew",
    [
      `assemble${configuration}`,
      ...(prebuild ? [] : ["-x", "lucentBuild"]),
      "-PreactNativeArchitectures=arm64-v8a",
      "--console=plain",
    ],
    android,
  );

  return apk();
}

/** Runs `f` holding the shared simulator lock. */
async function withLock<T>(f: () => Promise<T>): Promise<T> {
  for (;;) {
    try {
      fs.mkdirSync(lock);
      fs.writeFileSync(path.join(lock, "owner"), `views-spike ${new Date().toString()}\n`);
      break;
    } catch {
      console.log("• waiting for the simulator lock");
      await sleep(15);
    }
  }

  try {
    return await f();
  } finally {
    fs.rmSync(lock, { recursive: true, force: true });
  }
}

/** How the runner drives a device: install, launch, screenshots, the launch's log lines. */
type Device = {
  install(): void;
  launch(): void;
  stop(): void;
  screenshot(file: string): void;
  /** The device's clock (ms since the epoch), which its log's times use. */
  now?(): number;
  /** Taps the screen at pixel `x`, `y`. */
  tap?(x: number, y: number): void;
  /** Changes the app's situation (--ui); `restore` undoes what a launch changed. */
  ui?: { run(action: UiAction): void; restore(): void };
  lines(): string;
  /** The runtime's signposts, with --trace. */
  signposts?(): string;
  /** The whole device log, to tell a stall of the app from one of the device. */
  everything?(): string;
  /**
   * Makes the text size the user chose larger (--font-scale): live, while
   * the app runs, or before it launches. Gives back the device's own.
   */
  largerText: { live: boolean; apply(): () => void };
  /** Makes a configuration change while the app runs (--android-changes); gives back the device's own. */
  change?(name: keyof typeof ANDROID_CHANGES): () => void;
  /** Counts what the app's heap holds after a garbage collection (--heap), dumping it to `file`. */
  heap?(file: string): string;
};

function iosDevice(bundle: string): Device {
  const plist = path.join(bundle, "Info.plist");
  const id = sh("plutil", ["-extract", "CFBundleIdentifier", "raw", plist]).trim();
  let since = "";
  let pid = "";

  return {
    install() {
      spawnSync("xcrun", ["simctl", "boot", device], { encoding: "utf8" });
      sh("xcrun", ["simctl", "bootstatus", device, "-b"]);
      // Afresh: the spike counts JavaScript's starts in the app's defaults.
      spawnSync("xcrun", ["simctl", "uninstall", device, id]);
      sh("xcrun", ["simctl", "install", device, bundle]);
    },
    launch() {
      // `log show --start` reads the local time.
      const now = new Date(Date.now() - new Date().getTimezoneOffset() * 60_000);
      since = now.toISOString().replace("T", " ").slice(0, 19);
      // "<bundle id>: <pid>": the launch's lines are its process's.
      const launchEnv = {
        SIMCTL_CHILD_LUCENT_SIZING_TRACE: traceSizing ? "1" : "0",
        ...(trace ? { SIMCTL_CHILD_LUCENT_TRACE: "platform" } : {}),
      };

      pid = sh("xcrun", ["simctl", "launch", device, id], root, launchEnv)
        .trim()
        .split(": ")
        .at(-1)!;
    },
    stop() {
      spawnSync("xcrun", ["simctl", "terminate", device, id]);
    },
    ui: {
      run(action) {
        const run: Record<UiAction, string[]> = {
          // Another app in front: the spike's goes to the background.
          background: ["launch", device, "com.apple.Preferences"],
          // The running app, brought back as it is.
          foreground: ["launch", device, id],
          dark: ["ui", device, "appearance", "dark"],
          light: ["ui", device, "appearance", "light"],
        };

        sh("xcrun", ["simctl", ...run[action]]);
      },
      restore() {
        sh("xcrun", ["simctl", "ui", device, "appearance", "light"]);
        spawnSync("xcrun", ["simctl", "terminate", device, "com.apple.Preferences"]);
      },
    },
    screenshot(file) {
      sh("xcrun", ["simctl", "io", device, "screenshot", file]);
    },
    // The app's lines in the unified log: console.error (a Release build
    // logs no other level there), Lucent's console.log (the Pulses' ticks)
    // and the runtime's own reports.
    lines() {
      return sh("xcrun", [
        "simctl",
        "spawn",
        device,
        "log",
        "show",
        "--start",
        since,
        "--style",
        "compact",
        "--predicate",
        `processID == ${pid} AND ` +
          `(eventMessage CONTAINS "LUCENT" OR eventMessage CONTAINS "[lucent]")`,
      ]);
    },
    largerText: {
      live: true,
      apply() {
        const size = sh("xcrun", ["simctl", "ui", device, "content_size"]).trim();

        sh("xcrun", ["simctl", "ui", device, "content_size", "extra-extra-large"]);
        return () => sh("xcrun", ["simctl", "ui", device, "content_size", size]);
      },
    },
    signposts() {
      return sh("xcrun", [
        "simctl",
        "spawn",
        device,
        "log",
        "show",
        "--signpost",
        "--start",
        since,
        "--style",
        "compact",
        "--predicate",
        `processID == ${pid} AND subsystem == "dev.lucent"`,
      ]);
    },
  };
}

function androidDevice(apk: string): Device {
  const adb: Adb = (...args) => sh("adb", ["-s", device, ...args]);
  const id = spec.android.id;
  const sdk = process.env.ANDROID_HOME ?? path.join(os.homedir(), "Library/Android/sdk");

  return {
    install() {
      spawnSync("adb", ["-s", device, "uninstall", id]);
      adb("install", "-r", apk);
    },
    launch() {
      adb("logcat", "-c");
      adb("shell", "setprop", "debug.lucent.sizing", traceSizing ? "1" : "0");
      adb("shell", "am", "start", "-W", "-n", `${id}/.MainActivity`);
    },
    stop() {
      adb("shell", "am", "force-stop", id);
    },
    tap(x, y) {
      adb("shell", "input", "tap", String(x), String(y));
    },
    now() {
      return Number(adb("shell", "date", "+%s%3N").trim());
    },
    screenshot(file) {
      const screen = spawnSync("adb", ["-s", device, "exec-out", "screencap", "-p"], {
        maxBuffer: 1 << 28,
      });

      fs.writeFileSync(file, screen.stdout);
    },
    // console.error (ReactNativeJS), Lucent's console.log (the Pulses' ticks)
    // and the runtime's own reports.
    lines() {
      return this.everything!()
        .split("\n")
        .filter((l) => /(ReactNativeJS|Lucent)\s*:.*(LUCENT|\[lucent\])/.test(l))
        .join("\n");
    },
    everything() {
      return adb("logcat", "-d", "-v", "threadtime");
    },
    change(name) {
      return ANDROID_CHANGES[name](adb);
    },
    heap(file) {
      const remote = "/data/local/tmp/lucent-views-spike.hprof";
      const raw = `${file}.android`;

      // -g: after a garbage collection, so only reachable objects remain. Twice: a
      // callback's captures (a view among them) go when the first one finalizes it.
      adb("shell", "am", "dumpheap", "-g", id, remote);
      spawnSync("sleep", ["1"]);
      adb("shell", "am", "dumpheap", "-g", id, remote);
      adb("pull", remote, raw);
      adb("shell", "rm", remote);
      sh(path.join(sdk, "platform-tools/hprof-conv"), [raw, file]);

      try {
        return countClasses(file, HEAP_CLASSES)
          .map(
            (c) => `${c.name}: ${c.instances} live, ${c.jniGlobal} held by JNI global references`,
          )
          .join("\n");
      } finally {
        fs.rmSync(raw, { force: true });
        fs.rmSync(file, { force: true });
      }
    },
    largerText: {
      live: false,
      apply() {
        const scale = adb("shell", "settings", "get", "system", "font_scale").trim();

        adb("shell", "settings", "put", "system", "font_scale", "1.3");
        return () =>
          adb("shell", "settings", "put", "system", "font_scale", scale === "null" ? "1.0" : scale);
      },
    },
  };
}

// --- what a launch's log says -------------------------------------------------------------

type Tick = { name: string; n: number; at: number };

const longest = (times: number[]) =>
  times.length > 1 ? Math.max(...times.slice(1).map((t, i) => t - times[i]!)) : "-";

/**
 * For each isolation phase (its start and end in JavaScript's time): Pulse
 * A's native ticks inside it and the longest gap between them, against
 * the ticks JavaScript heard of during the phase, and how late; and how
 * many of Pulse C's ticks inside it JavaScript heard, C's level being
 * coalesced (only the latest waits while JavaScript is busy).
 */
function summarize(log: string): string {
  const ticks: Tick[] = [];
  const heard: (Tick & { rx: number })[] = [];
  const levels: (Tick & { rx: number })[] = [];
  const phases = new Map<string, { start?: number; end?: number; out?: string }>();

  for (const line of log.split("\n")) {
    let m = /LUCENT_TICK (\S+) n=(\d+) at=(\d+)/.exec(line);
    if (m) ticks.push({ name: m[1]!, n: +m[2]!, at: +m[3]! });

    m = /tick-rx (\S+) mount=\d+ n=(\d+) at=(\d+) rx=(\d+)/.exec(line);
    if (m) heard.push({ name: m[1]!, n: +m[2]!, at: +m[3]!, rx: +m[4]! });

    m = /level-rx (\S+) n=(\d+) at=(\d+) rx=(\d+)/.exec(line);
    if (m) levels.push({ name: m[1]!, n: +m[2]!, at: +m[3]!, rx: +m[4]! });

    m = /phase (\S+) (start|end) at=(\d+)(?: out=([\d-]+))?/.exec(line);
    if (m) {
      const phase = phases.get(m[1]!) ?? {};
      phase[m[2] as "start" | "end"] = +m[3]!;
      if (m[4]) phase.out = m[4];
      phases.set(m[1]!, phase);
    }
  }

  const a = ticks.filter((t) => t.name === "A");
  const rows = [...phases].map(([name, { start, end, out }]) => {
    if (start === undefined || end === undefined) return `${name}: incomplete`;

    const inside = a.filter((t) => t.at >= start && t.at <= end);
    const around = a.filter((t) => t.at >= start - 150 && t.at <= end + 150).map((t) => t.at);
    const late = heard.filter((h) => h.name === "A" && h.at >= start && h.at <= end);
    // Strictly inside: what JavaScript hears as the phase ends is logged after it.
    const during = heard.filter((h) => h.name === "A" && h.rx > start && h.rx < end);
    const latest = late.length ? Math.max(...late.map((h) => h.rx - h.at)) : "-";
    const c = ticks.filter((t) => t.name === "C" && t.at >= start && t.at <= end);
    const cHeard = levels.filter((l) => l.name === "C" && l.at >= start && l.at <= end);

    return [
      `${name}: ${end - start} ms${out ? ` (task ${out})` : ""}`,
      `native ticks ${inside.length}, longest gap ${longest(around)} ms`,
      `JavaScript heard ${during.length} during it; of its ticks ${late.length} heard, ` +
        `latest ${latest} ms late`,
      `C (coalesced): ${cHeard.length} of its ${c.length} ticks heard`,
    ].join("; ");
  });

  return [
    `Pulse A: ${a.length} native ticks, longest gap ${longest(a.map((t) => t.at))} ms`,
    ...rows,
  ].join("\n");
}

/** The threads' Lucent lock waits (lucent-lock signposts), the main thread's apart. */
function lockWaits(log: string, signposts: string): string {
  const thread = (line: string) => /\[\d+:([0-9a-f]+)\]/.exec(line)?.[1];
  const main = thread(log.split("\n").find((l) => l.includes("LUCENT_TICK")) ?? "");
  const waits = new Map<string, number>();

  for (const line of signposts.split("\n")) {
    const tid = thread(line);
    if (tid && line.includes("lucent-lock")) waits.set(tid, (waits.get(tid) ?? 0) + 1);
  }

  const threads = [...waits].map(([tid, n]) => `${tid}${tid === main ? " (main)" : ""}: ${n}`);

  return `Lucent lock signposts by thread (main ${main ?? "?"}): ${threads.join(", ") || "none"}`;
}

async function run(bundle: string): Promise<void> {
  const target = platform === "android" ? androidDevice(bundle) : iosDevice(bundle);

  await withLock(async () => {
    target.install();

    // Restored after the launches (on Android, that restarts the activity),
    // or after each launch for a live change.
    const restores: (() => void)[] = [];
    const launchRestores: (() => void)[] = [];

    if (fontScale && !target.largerText.live) restores.push(target.largerText.apply());

    try {
      for (let launch = 1; launch <= launches; launch++) {
        const dir = path.join(out, `launch-${launch}`);
        fs.mkdirSync(dir, { recursive: true });

        target.stop();
        target.launch();

        const started = Date.now();
        const elapsed = () => (Date.now() - started) / 1000;

        // Screenshots, taps and the live text size change, in time order.
        const events: [number, () => void][] = shots.map((at) => [
          at,
          () => {
            // Taken when the device answers: a busy one is late.
            const taken = `${elapsed().toFixed(2)} s (device clock ${target.now?.() ?? "?"})`;

            target.screenshot(path.join(dir, `shot-${at}s.png`));
            fs.appendFileSync(path.join(dir, "shots.txt"), `shot-${at}s.png taken at ${taken}\n`);
          },
        ]);

        if (fontScale && target.largerText.live && fontScaleAt < wait)
          events.push([fontScaleAt, () => launchRestores.push(target.largerText.apply())]);

        for (const { action, at } of uiEvents)
          events.push([
            at,
            () => {
              if (!target.ui) throw new Error(`--ui is not supported on ${platform}`);
              target.ui.run(action);
              console.log(`• ${action} at ${elapsed().toFixed(1)} s`);
            },
          ]);

        for (const { name, at } of changes)
          events.push([
            at,
            () => {
              if (!target.change)
                throw new Error(`--android-changes is not supported on ${platform}`);
              launchRestores.push(target.change(name));
              console.log(`• changed ${name} at ${elapsed().toFixed(1)} s`);
            },
          ]);

        for (const at of heaps)
          events.push([
            at,
            () => {
              if (!target.heap) throw new Error(`--heap is not supported on ${platform}`);
              const counts = target.heap(path.join(dir, `heap-${at}s.hprof`));
              const taken = `taken at ${elapsed().toFixed(1)} s`;

              fs.writeFileSync(path.join(dir, `heap-${at}s.txt`), `${taken}\n${counts}\n`);
              console.log(`• heap at ${at} s (${taken})\n${counts}`);
            },
          ]);

        for (const { x, y, at } of taps)
          events.push([
            at,
            () => {
              if (!target.tap) throw new Error(`--tap is not supported on ${platform}`);
              target.tap(x, y);
              console.log(`• tapped ${x},${y} at ${elapsed().toFixed(1)} s`);
            },
          ]);

        try {
          for (const [at, event] of events.toSorted(([x], [y]) => x - y)) {
            await sleep(Math.max(0, at - elapsed()));
            event();
          }

          await sleep(Math.max(0, wait - elapsed()));
          target.screenshot(path.join(dir, "screen.png"));
        } finally {
          const lines = target.lines();
          const signposts = trace ? (target.signposts?.() ?? "") : "";
          const summary = [summarize(lines), ...(trace ? [lockWaits(lines, signposts)] : [])].join(
            "\n",
          );

          if (trace) fs.writeFileSync(path.join(dir, "trace.txt"), signposts);
          if (target.everything)
            fs.writeFileSync(path.join(dir, "device.txt"), target.everything());

          target.stop();
          fs.writeFileSync(path.join(dir, "log.txt"), `${lines}\n`);
          fs.writeFileSync(path.join(dir, "summary.txt"), `${summary}\n`);

          const steps = lines.split("\n").filter((l) => !/LUCENT_TICK|tick-rx|level-rx/.test(l));

          console.log(`${steps.join("\n")}\n${summary}`);

          // A live change ends with its launch.
          for (const restore of launchRestores.splice(0)) restore();
          if (uiEvents.length) target.ui?.restore();
        }
      }
    } finally {
      for (const restore of [...launchRestores, ...restores]) restore();
    }
  });

  console.log(`• evidence in ${out}`);
}

const bundle = skipBuild ? (platform === "android" ? apk() : iosBundle()) : build();

await run(bundle);
