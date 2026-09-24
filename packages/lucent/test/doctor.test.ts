import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { type Check, diagnose, type Probe, type RunResult } from "../src/cli/doctor.ts";

/** A bare React Native app wired for Lucent, as files on disk. */
function app(overrides: Record<string, string | undefined> = {}): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "lucent-doctor-"));
  const files: Record<string, string | undefined> = {
    "package.json": JSON.stringify({ name: "app", dependencies: { "react-native": "0.88.0" }, devDependencies: { "@lucent-lang/lucent": "0.0.3" } }),
    "pnpm-lock.yaml": "lockfileVersion: '9.0'\n",
    "node_modules/react-native/package.json": JSON.stringify({ name: "react-native", version: "0.88.0" }),
    "node_modules/@lucent-lang/lucent/package.json": JSON.stringify({ name: "@lucent-lang/lucent", version: "0.0.3" }),
    "metro.config.js": 'const { withLucent } = require("@lucent-lang/lucent/metro");\nmodule.exports = withLucent({});\n',
    "tsconfig.json": '{ "compilerOptions": { "paths": { "lucent:*": ["./.lucent/native/types/*"] } } }\n',
    "ios/Podfile": "platform :ios, '15.1'\n",
    "android/app/build.gradle": 'apply plugin: "com.android.application"\napply from: new File(["node", "--print", "require.resolve(\'@lucent-lang/lucent/package.json\')"].execute(null, rootDir).text.trim(), "../gradle/lucent.gradle")\n',
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
    for (const d of ["platforms/android-36", "ndk/27.1.12297006", "platform-tools"]) fs.mkdirSync(path.join(sdk, d), { recursive: true });
  }
  const tools: Record<string, RunResult> = {
    "xcodebuild -version": { status: 0, stdout: "Xcode 26.0\nBuild version 17A324\n", stderr: "" },
    "xcrun simctl list runtimes --json": { status: 0, stdout: JSON.stringify({ runtimes: [{ name: "iOS 26.0", platform: "iOS", isAvailable: true }] }), stderr: "" },
    "pod --version": { status: 0, stdout: "1.16.2\n", stderr: "" },
    "java -version": { status: 0, stdout: "", stderr: 'openjdk version "21.0.4" 2024-07-16\n' },
  };
  return {
    platform: "darwin",
    env: {},
    home,
    nodeVersion: "v24.16.0",
    cliVersion: "0.0.3",
    run: (cmd, args) => {
      const key = [cmd, ...args].join(" ");
      if (missing.some((m) => key.startsWith(m))) return { status: null, stdout: "", stderr: `${cmd}: command not found` };
      return tools[key] ?? { status: null, stdout: "", stderr: `${cmd}: command not found` };
    },
  };
}

const find = (checks: Check[], id: string) => checks.find((c) => c.id === id)!;

describe("lucent doctor", () => {
  it("passes a machine and an app that have everything", () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "lucent-home-"));
    const checks = diagnose(app(), machine(home));
    expect(checks.filter((c) => c.status === "fail" || c.status === "warn").map((c) => `${c.id}: ${c.detail}`)).toEqual([]);
    for (const id of ["node", "package-manager", "react-native", "xcode", "cocoapods", "android-sdk", "ndk", "jdk", "gradle-task", "metro", "tsconfig", "versions"]) expect(find(checks, id), id).toBeDefined();
  });

  it("finds a missing Android SDK, and says how to install it", () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "lucent-home-"));
    const c = find(diagnose(app(), machine(home, ["android-sdk"])), "android-sdk");
    expect(c).toMatchObject({ status: "fail" });
    expect(c.fix).toMatch(/Android Studio.*ANDROID_HOME/);
  });

  it("finds a missing CocoaPods", () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "lucent-home-"));
    const c = find(diagnose(app(), machine(home, ["pod"])), "cocoapods");
    expect(c).toMatchObject({ status: "fail" });
    expect(c.fix).toMatch(/brew install cocoapods/);
  });

  it("finds a Metro config without withLucent", () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "lucent-home-"));
    const c = find(diagnose(app({ "metro.config.js": 'module.exports = require("@react-native/metro-config").getDefaultConfig(__dirname);\n' }), machine(home)), "metro");
    expect(c).toMatchObject({ status: "fail" });
    expect(c.fix).toMatch(/withLucent.*@lucent-lang\/lucent\/metro/);
  });

  it("finds an Android app without the Lucent Gradle task", () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "lucent-home-"));
    const c = find(diagnose(app({ "android/app/build.gradle": 'apply plugin: "com.android.application"\n' }), machine(home)), "gradle-task");
    expect(c).toMatchObject({ status: "fail" });
    expect(c.fix).toMatch(/lucent init/);
  });

  it("finds mismatched versions: the app's Lucent is not the one running", () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "lucent-home-"));
    const root = app({ "node_modules/@lucent-lang/lucent/package.json": JSON.stringify({ name: "@lucent-lang/lucent", version: "0.0.2" }) });
    const c = find(diagnose(root, machine(home)), "versions");
    expect(c).toMatchObject({ status: "fail" });
    expect(c.detail).toMatch(/0\.0\.2.*0\.0\.3|0\.0\.3.*0\.0\.2/);
    expect(c.fix).toMatch(/npx lucent/);
  });

  it("finds a Lucent package that does not support this Lucent", () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "lucent-home-"));
    const root = app({
      "package.json": JSON.stringify({ name: "app", dependencies: { "react-native": "0.88.0", "lucent-old": "1.0.0" } }),
      "node_modules/lucent-old/package.json": JSON.stringify({ name: "lucent-old", version: "1.0.0", lucent: { sources: "src", compatible: "^9.0.0" } }),
    });
    const c = find(diagnose(root, machine(home)), "versions");
    expect(c).toMatchObject({ status: "fail" });
    expect(c.detail).toMatch(/lucent-old/);
  });

  it("does not load TypeScript or the compiler", () => {
    const hook = `data:text/javascript,${encodeURIComponent('import { registerHooks } from "node:module"; registerHooks({ resolve(s, c, next) { process.stderr.write("[resolve] " + s + "\\n"); return next(s, c); } });')}`;
    const r = spawnSync(process.execPath, ["--import", "tsx", "--import", hook, path.resolve(import.meta.dirname, "../src/cli/main.ts"), "doctor", "--root", app()], { encoding: "utf8" });
    const modules = r.stderr.split("\n").filter((l) => l.startsWith("[resolve] ")).map((l) => l.slice(10));
    expect(modules.filter((m) => m === "typescript" || m === "@lucent-lang/compiler")).toEqual([]);
  });
});
