import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vite-plus/test";
import { APP_DELEGATE, APP_FORWARDS, withForwards } from "../src/cli/init/app-delegate.ts";
import { type Check, diagnose, type Probe, type RunResult } from "../src/cli/doctor.ts";
import { runToExit } from "./run-to-exit.ts";

/** A bare React Native app wired for Lucent, as files on disk. */
function app(overrides: Record<string, string | undefined> = {}): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "lucent-doctor-"));
  const files: Record<string, string | undefined> = {
    "package.json": JSON.stringify({
      name: "app",
      dependencies: { "react-native": "0.88.0" },
      devDependencies: { "@lucent-lang/lucent": "0.0.3" },
    }),
    "pnpm-lock.yaml": "lockfileVersion: '9.0'\n",
    "node_modules/react-native/package.json": JSON.stringify({
      name: "react-native",
      version: "0.88.0",
    }),
    "node_modules/@lucent-lang/lucent/package.json": JSON.stringify({
      name: "@lucent-lang/lucent",
      version: "0.0.3",
    }),
    "metro.config.js":
      'const { withLucent } = require("@lucent-lang/lucent/metro");\nmodule.exports = withLucent({});\n',
    "tsconfig.json":
      '{ "compilerOptions": { "paths": { "lucent:*": ["./.lucent/native/types/*"] } } }\n',
    "ios/Podfile": "platform :ios, '15.1'\ntarget 'App' do\n  config = use_native_modules!\nend\n",
    "react-native.config.js":
      'module.exports = { dependencies: { "lucent": require("@lucent-lang/lucent/autolink")(__dirname) } };\n',
    "android/app/build.gradle":
      'apply plugin: "com.android.application"\napply from: new File(["node", "--print", "require.resolve(\'@lucent-lang/lucent/package.json\')"].execute(null, rootDir).text.trim(), "../gradle/lucent.gradle")\n',
    ...overrides,
  };
  for (const [name, text] of Object.entries(files)) {
    if (text === undefined) continue;
    fs.mkdirSync(path.dirname(path.join(root, name)), { recursive: true });
    fs.writeFileSync(path.join(root, name), text);
  }
  return root;
}

/** A Mac with every tool installed, unless `missing` says otherwise. */
function machine(home: string, missing: string[] = []): Probe {
  const sdk = path.join(home, "Library/Android/sdk");
  if (!missing.includes("android-sdk")) {
    for (const d of ["platforms/android-36", "ndk/27.1.12297006", "platform-tools"])
      fs.mkdirSync(path.join(sdk, d), { recursive: true });
  }
  const tools: Record<string, RunResult> = {
    "xcodebuild -version": { status: 0, stdout: "Xcode 26.0\nBuild version 17A324\n", stderr: "" },
    "xcrun simctl list runtimes --json": {
      status: 0,
      stdout: JSON.stringify({
        runtimes: [{ name: "iOS 26.0", platform: "iOS", isAvailable: true }],
      }),
      stderr: "",
    },
    "pod --version": { status: 0, stdout: "1.16.2\n", stderr: "" },
    "java -version": { status: 0, stdout: "", stderr: 'openjdk version "21.0.4" 2024-07-16\n' },
  };
  return {
    platform: "darwin",
    env: missing.includes("android-sdk") ? {} : { ANDROID_HOME: sdk },
    home,
    nodeVersion: "v24.16.0",
    cliVersion: "0.0.3",
    run: (cmd, args) => {
      const key = [cmd, ...args].join(" ");
      if (missing.some((m) => key.startsWith(m)))
        return { status: null, stdout: "", stderr: `${cmd}: command not found` };
      return tools[key] ?? { status: null, stdout: "", stderr: `${cmd}: command not found` };
    },
  };
}

const find = (checks: Check[], id: string) => checks.find((c) => c.id === id)!;

describe("lucent doctor", () => {
  it("passes a machine and an app that have everything", () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "lucent-home-"));
    const checks = diagnose(app(), machine(home));
    expect(
      checks
        .filter((c) => c.status === "fail" || c.status === "warn")
        .map((c) => `${c.id}: ${c.detail}`),
    ).toEqual([]);
    for (const id of [
      "node",
      "package-manager",
      "react-native",
      "xcode",
      "cocoapods",
      "android-sdk",
      "ndk",
      "jdk",
      "gradle-task",
      "autolinking",
      "metro",
      "tsconfig",
      "versions",
    ])
      expect(find(checks, id), id).toBeDefined();
  });

  it("finds a missing Android SDK, and says how to install it", () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "lucent-home-"));
    const c = find(diagnose(app(), machine(home, ["android-sdk"])), "android-sdk");
    expect(c).toMatchObject({ status: "fail" });
    expect(c.fix).toMatch(/Android Studio.*ANDROID_HOME/);
  });

  it("finds the Android SDK where Android Studio installs it on Windows", () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "lucent-home-"));
    const local = path.join(home, "AppData", "Local");
    fs.mkdirSync(path.join(local, "Android/Sdk/platforms/android-36"), { recursive: true });
    const probe = { ...machine(home, ["android-sdk"]), platform: "win32" as const };

    const found = find(diagnose(app(), { ...probe, env: { LOCALAPPDATA: local } }), "android-sdk");
    expect(found.detail).toMatch(/android-36/);
    // Found, though ANDROID_HOME isn't set: Gradle needs it, set the Windows way.
    expect(found).toMatchObject({ status: "warn" });
    expect(found.fix).toMatch(/^setx ANDROID_HOME /);

    const elsewhere = fs.mkdtempSync(path.join(os.tmpdir(), "lucent-home-"));
    const missing = find(diagnose(app(), { ...probe, home: elsewhere, env: {} }), "android-sdk");
    expect(missing.fix).toMatch(/%LOCALAPPDATA%\\Android\\Sdk/);
  });

  it("finds a react-native.config.js that links .lucent/native without building it", () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "lucent-home-"));
    const plain = app({
      "react-native.config.js":
        'module.exports = { dependencies: { "lucent": { root: require("path").join(__dirname, ".lucent", "native") } } };\n',
    });
    const c = find(diagnose(plain, machine(home)), "autolinking");
    expect(c).toMatchObject({ status: "warn" });
    expect(c.detail).toMatch(/fresh clone/);
    expect(c.fix).toMatch(/lucent init/);

    const none = find(
      diagnose(app({ "react-native.config.js": undefined }), machine(home)),
      "autolinking",
    );
    expect(none).toMatchObject({ status: "fail" });

    const podfile = find(
      diagnose(app({ "ios/Podfile": "target 'App' do\nend\n" }), machine(home)),
      "autolinking",
    );
    expect(podfile).toMatchObject({ status: "fail" });
    expect(podfile.detail).toMatch(/use_native_modules!/);
  });

  it("finds an app delegate that doesn't forward to Lucent modules, and says to run lucent init", () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "lucent-home-"));
    const delegate = `import UIKit\n\n@main\nclass AppDelegate: UIResponder, UIApplicationDelegate {\n  func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {\n    true\n  }\n}\n`;
    const missing = find(
      diagnose(app({ "ios/App/AppDelegate.swift": delegate }), machine(home)),
      "app-delegate",
    );
    expect(missing.status).toBe("warn");
    expect(missing.detail).toContain("AppDelegate application(_:open:options:)");
    expect(missing.fix).toBe("run lucent init, which adds the calls");

    const forwarded = withForwards(delegate, APP_DELEGATE, APP_FORWARDS)!;
    const ok = find(
      diagnose(app({ "ios/App/AppDelegate.swift": forwarded }), machine(home)),
      "app-delegate",
    );
    expect(ok.status).toBe("ok");
    expect(find(diagnose(app(), machine(home)), "app-delegate").status).toBe("skip");
  });

  it("finds a missing CocoaPods", () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "lucent-home-"));
    const c = find(diagnose(app(), machine(home, ["pod"])), "cocoapods");
    expect(c).toMatchObject({ status: "fail" });
    expect(c.fix).toMatch(/brew install cocoapods/);
  });

  it("finds a Metro config without withLucent", () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "lucent-home-"));
    const c = find(
      diagnose(
        app({
          "metro.config.js":
            'module.exports = require("@react-native/metro-config").getDefaultConfig(__dirname);\n',
        }),
        machine(home),
      ),
      "metro",
    );
    expect(c).toMatchObject({ status: "fail" });
    expect(c.fix).toMatch(/withLucent.*@lucent-lang\/lucent\/metro/);
  });

  it("finds an Android app without the Lucent Gradle task", () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "lucent-home-"));
    const c = find(
      diagnose(
        app({ "android/app/build.gradle": 'apply plugin: "com.android.application"\n' }),
        machine(home),
      ),
      "gradle-task",
    );
    expect(c).toMatchObject({ status: "fail" });
    expect(c.fix).toMatch(/lucent init/);
  });

  it("names the Kotlin build script that lacks the Gradle task", () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "lucent-home-"));
    const c = find(
      diagnose(
        app({
          "android/app/build.gradle": undefined,
          "android/app/build.gradle.kts": 'plugins {\n  id("com.android.application")\n}\n',
        }),
        machine(home),
      ),
      "gradle-task",
    );
    expect(c).toMatchObject({ status: "fail" });
    expect(c.detail).toMatch(/android\/app\/build\.gradle\.kts does not apply it/);
  });

  it("checks React Native against the window and names the lane", () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "lucent-home-"));
    const with_ = (version: string) =>
      find(
        diagnose(
          app({
            "node_modules/react-native/package.json": JSON.stringify({
              name: "react-native",
              version,
            }),
          }),
          machine(home),
        ),
        "react-native",
      );

    // The window: 0.86 is Expo SDK 57's (decisions 0079 and 0127).
    for (const v of ["0.86.3", "0.87.1", "0.88.0"])
      expect(with_(v)).toMatchObject({
        status: "ok",
        detail: `${v}, a stable release Lucent supports`,
      });
    // A candidate of a release in the window is that release's.
    expect(with_("0.88.0-rc.4")).toMatchObject({ status: "ok" });
    expect(with_("0.89.0-rc.1")).toMatchObject({
      status: "ok",
      detail: "0.89.0-rc.1, on Lucent's prerelease lane",
    });
    expect(with_("0.85.3")).toMatchObject({
      status: "fail",
      detail: "0.85.3; Lucent supports 0.86 to 0.88, and 0.89 on its prerelease lane",
      fix: "upgrade react-native to 0.88",
    });
    expect(with_("0.90.0")).toMatchObject({
      status: "warn",
      fix: "use react-native 0.88, or a Lucent release that supports 0.90",
    });
  });

  it("checks the Expo SDK against the window and names the lane", () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "lucent-home-"));
    const with_ = (version: string) =>
      find(
        diagnose(
          app({
            "package.json": JSON.stringify({
              name: "app",
              dependencies: { expo: `~${version}`, "react-native": "0.86.3" },
            }),
            "node_modules/expo/package.json": JSON.stringify({ name: "expo", version }),
          }),
          machine(home),
        ),
        "expo",
      );

    expect(with_("57.0.27")).toMatchObject({
      status: "ok",
      detail: "57 (expo 57.0.27), a stable SDK Lucent supports",
    });
    expect(with_("58.0.12")).toMatchObject({ status: "ok" });
    expect(with_("59.0.0-preview.1")).toMatchObject({
      status: "ok",
      detail: "59 (expo 59.0.0-preview.1), on Lucent's prerelease lane",
    });
    expect(with_("56.0.23")).toMatchObject({
      status: "fail",
      detail: "expo 56.0.23; Lucent supports SDK 57 and 58, and SDK 59 on its prerelease lane",
      fix: "upgrade to Expo SDK 58 (npx expo install expo@^58.0.0 --fix)",
    });
    expect(with_("60.0.0")).toMatchObject({ status: "warn" });
  });

  it("finds mismatched versions: the app's Lucent is not the one running", () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "lucent-home-"));
    const root = app({
      "node_modules/@lucent-lang/lucent/package.json": JSON.stringify({
        name: "@lucent-lang/lucent",
        version: "0.0.2",
      }),
    });
    const c = find(diagnose(root, machine(home)), "versions");
    expect(c).toMatchObject({ status: "fail" });
    expect(c.detail).toMatch(/0\.0\.2.*0\.0\.3|0\.0\.3.*0\.0\.2/);
    expect(c.fix).toMatch(/npx lucent/);
  });

  it("finds a Lucent package that does not support this Lucent", () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "lucent-home-"));
    const root = app({
      "package.json": JSON.stringify({
        name: "app",
        dependencies: { "react-native": "0.88.0", "lucent-old": "1.0.0" },
      }),
      "node_modules/lucent-old/package.json": JSON.stringify({
        name: "lucent-old",
        version: "1.0.0",
        lucent: { sources: "src", compatible: "^9.0.0" },
      }),
    });
    const c = find(diagnose(root, machine(home)), "versions");
    expect(c).toMatchObject({ status: "fail" });
    expect(c.detail).toMatch(/lucent-old/);
  });

  it("does not load TypeScript or the compiler", () => {
    const hook = `data:text/javascript,${encodeURIComponent('import { registerHooks } from "node:module"; registerHooks({ resolve(s, c, next) { process.stderr.write("[resolve] " + s + "\\n"); return next(s, c); } });')}`;
    const r = runToExit(
      process.execPath,
      [
        "--import",
        hook,
        path.resolve(import.meta.dirname, "../src/cli/main.ts"),
        "doctor",
        "--root",
        app(),
      ],
      {},
      "lucent doctor",
    );
    const modules = r.stderr
      .split("\n")
      .filter((l) => l.startsWith("[resolve] "))
      .map((l) => l.slice(10));
    expect(modules.filter((m) => m === "typescript" || m === "@lucent-lang/compiler")).toEqual([]);
  });
});

/** What `lucent build` wrote for an app built for iOS and Android. */
const IDENTITY = {
  runtimeAbi: 1,
  programs: { ios: "aaaaaaaaaaaaaaaa", android: "bbbbbbbbbbbbbbbb" },
  apis: {
    ios: { battery: "1111111111111111", device: "2222222222222222" },
    android: { battery: "1111111111111111", device: "2222222222222222" },
  },
};

const identityJs = (identity: object) =>
  `// Generated by Lucent. Do not edit.\n"use strict";\nmodule.exports = ${JSON.stringify(identity)};\n`;

/** A build record of `nodes` (id, status, inputs as key → hash), and what it said the app needs. */
function record(
  nodes: {
    id: string;
    status: string;
    inputs?: Record<string, string>;
    detail?: string;
    log?: string;
  }[],
  pendingActions: { kind: string; targets: string[]; files: string[] }[] = [],
) {
  return JSON.stringify({
    schemaVersion: 1,
    mode: "build",
    nodes: nodes.map((n) => ({
      id: n.id,
      kind: n.id.split(":")[0],
      status: n.status,
      inputs: Object.entries(n.inputs ?? {}).map(([key, hash]) => ({ key, hash })),
      outputs: [],
      hash: JSON.stringify(n.inputs ?? {}),
      ...(n.detail ? { detail: n.detail } : {}),
      ...(n.log ? { log: n.log } : {}),
    })),
    requiredAction: { kind: "none" },
    pendingActions,
    timings: {},
    startedAt: {},
  });
}

/** A native binary holding the strings Lucent's identity unit compiles in. */
const binary = (...strings: string[]) =>
  Buffer.concat([
    Buffer.from([0xcf, 0xfa, 0xed, 0xfe]),
    ...strings.map((x) => Buffer.from(`\0${x}\0`)),
  ]);

/** An iOS simulator build of the app in Xcode's DerivedData (under `home`), its executable `contents`. */
function xcodeBuild(root: string, home: string, contents: Buffer): void {
  const derived = path.join(home, "Library/Developer/Xcode/DerivedData/App-abc");
  const products = path.join(derived, "Build/Products/Debug-iphonesimulator/App.app");

  fs.mkdirSync(products, { recursive: true });
  fs.writeFileSync(
    path.join(derived, "info.plist"),
    `<?xml version="1.0" encoding="UTF-8"?>\n<plist version="1.0"><dict><key>WorkspacePath</key><string>${root}/ios/App.xcworkspace</string></dict></plist>\n`,
  );
  fs.writeFileSync(path.join(products, "App.debug.dylib"), contents);
}

describe("lucent doctor and the app's build", () => {
  const home = () => fs.mkdtempSync(path.join(os.tmpdir(), "lucent-home-"));

  it("says there is no build yet, without failing", () => {
    const checks = diagnose(app(), machine(home()));

    for (const id of ["last-build", "cache", "native-targets", "native-build"])
      expect(find(checks, id), id).toMatchObject({ status: "skip" });
  });

  it("names the steps the last build failed at, with what they said and their log", () => {
    const root = app({
      ".lucent/build-record.json": record([
        { id: "check", status: "ok" },
        {
          id: "resolve:android",
          status: "failed",
          detail: "androidx.core:core 1.16.0 and 1.12.0 conflict\nmore lines",
          log: ".lucent/logs/gradle.log",
        },
      ]),
    });
    const c = find(diagnose(root, machine(home())), "last-build");

    expect(c).toMatchObject({ status: "fail" });
    expect(c.detail).toContain("resolve:android: androidx.core:core 1.16.0 and 1.12.0 conflict");
    expect(c.detail).not.toContain("more lines");
    expect(c.fix).toContain(".lucent/logs/gradle.log");
  });

  it("says what the last build left the app needing", () => {
    const root = app({
      ".lucent/build-record.json": record(
        [{ id: "check", status: "ok" }],
        [{ kind: "compile-native", targets: ["ios"], files: ["ios/m_battery.mm"] }],
      ),
    });
    const c = find(diagnose(root, machine(home())), "last-build");

    expect(c).toMatchObject({ status: "ok" });
    expect(c.detail).toContain("compile-native (ios)");
  });

  it("says why steps ran again, and warns of one that ran again for nothing", () => {
    const root = app({
      ".lucent/build-record.previous.json": record([
        // Resolving runs every build: it computes the inputs the others are reused by.
        { id: "resolve", status: "ok", inputs: { "native-dependencies": "1" } },
        { id: "check", status: "ok", inputs: { "src/a.lucent.ts": "1", "src/b.lucent.ts": "1" } },
        { id: "generate:ios", status: "ok", inputs: { "ios/schema": "1" } },
        { id: "extract:UIKit", status: "ok", inputs: { UIKit: "1" } },
      ]),
      ".lucent/build-record.json": record([
        { id: "resolve", status: "ok", inputs: { "native-dependencies": "1" } },
        { id: "check", status: "ok", inputs: { "src/a.lucent.ts": "2", "src/b.lucent.ts": "1" } },
        { id: "generate:ios", status: "cached", inputs: { "ios/schema": "1" } },
        { id: "extract:UIKit", status: "ok", inputs: { UIKit: "1" } },
      ]),
    });
    const c = find(diagnose(root, machine(home())), "cache");

    expect(c).toMatchObject({ status: "warn" });
    expect(c.detail).toContain("1 of 3 steps reused");
    expect(c.detail).toContain("check ran again: src/a.lucent.ts changed");
    expect(c.detail).toContain("extract:UIKit ran again with the same inputs");
    expect(c.detail).not.toContain("resolve");
  });

  it("finds a platform the app has that this JavaScript was built without", () => {
    const root = app({
      ".lucent/native/js/_lucent/identity.js": identityJs({
        ...IDENTITY,
        programs: { ios: IDENTITY.programs.ios },
      }),
    });
    const c = find(diagnose(root, machine(home())), "native-targets");

    expect(c).toMatchObject({ status: "fail" });
    expect(c.detail).toContain("android");
    expect(c.fix).toMatch(/lucent build/);
  });

  it("finds a native build made from these sources", () => {
    const h = home();
    const root = app({ ".lucent/native/js/_lucent/identity.js": identityJs(IDENTITY) });
    xcodeBuild(
      root,
      h,
      binary(
        "__lucentIdentity",
        "ios",
        IDENTITY.programs.ios,
        "battery",
        "1111111111111111",
        "device",
        "2222222222222222",
      ),
    );

    const c = find(diagnose(root, machine(h)), "native-build");

    expect(c).toMatchObject({ status: "ok" });
    expect(c.detail).toContain("ios: built from these sources");
  });

  it("warns of a native build of other sources with the same APIs, as the app does", () => {
    const h = home();
    const root = app({ ".lucent/native/js/_lucent/identity.js": identityJs(IDENTITY) });
    xcodeBuild(
      root,
      h,
      binary("__lucentIdentity", "ios", "cccccccccccccccc", "1111111111111111", "2222222222222222"),
    );

    const c = find(diagnose(root, machine(h)), "native-build");

    expect(c).toMatchObject({ status: "warn" });
    expect(c.detail).toContain("ios: built from other sources, with the same APIs");
    expect(c.fix).toContain("compile-native");
  });

  it("fails a native build whose modules the app would refuse to load", () => {
    const h = home();
    const root = app({ ".lucent/native/js/_lucent/identity.js": identityJs(IDENTITY) });
    xcodeBuild(
      root,
      h,
      binary("__lucentIdentity", "ios", "cccccccccccccccc", "1111111111111111", "9999999999999999"),
    );

    const c = find(diagnose(root, machine(h)), "native-build");

    expect(c).toMatchObject({ status: "fail" });
    expect(c.detail).toContain("ios: device has another API than this JavaScript expects");
    expect(c.fix).toContain("compile-native");
  });

  it("reads Android's native library, built by Gradle", () => {
    const root = app({
      ".lucent/native/js/_lucent/identity.js": identityJs(IDENTITY),
    });
    const lib = path.join(
      root,
      "android/app/build/intermediates/merged_native_libs/debug/out/lib/arm64-v8a",
    );
    fs.mkdirSync(lib, { recursive: true });
    fs.writeFileSync(
      path.join(lib, "liblucentnative.so"),
      binary(
        "__lucentIdentity",
        "android",
        IDENTITY.programs.android,
        "1111111111111111",
        "2222222222222222",
      ),
    );

    const c = find(diagnose(root, machine(home())), "native-build");

    expect(c).toMatchObject({ status: "ok" });
    expect(c.detail).toContain("android: built from these sources");
  });
});
