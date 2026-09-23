import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { sdkAvailable } from "@lucent-lang/compiler";

const android = sdkAvailable("android");
const bin = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../bin/lucent.cjs");

function lucent(root: string, ...args: string[]) {
  const r = spawnSync(process.execPath, [bin, ...args, "--root", root], { encoding: "utf8" });
  return { status: r.status, out: r.stdout + r.stderr };
}

function project(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "lucent-cli-"));
  fs.writeFileSync(path.join(root, "a.lucent.ts"), "export function one(): number { return 1; }\n");
  return root;
}

describe("lucent build", () => {
  it("skips work when nothing changed", () => {
    const root = project();
    expect(lucent(root, "build").out).toContain("Compiled 1 module");
    const second = lucent(root, "build");
    expect(second.status).toBe(0);
    expect(second.out).toContain("up to date");
  });

  it("rebuilds when a source changes, and with --force", () => {
    const root = project();
    lucent(root, "build");
    fs.writeFileSync(path.join(root, "a.lucent.ts"), "export function one(): number { return 2; }\n");
    expect(lucent(root, "build").out).toContain("Compiled 1 module");
    expect(lucent(root, "build", "--force").out).toContain("Compiled 1 module");
  });

  it("rebuilds when the output was deleted", () => {
    const root = project();
    lucent(root, "build");
    fs.rmSync(path.join(root, ".lucent"), { recursive: true });
    expect(lucent(root, "build").out).toContain("Compiled 1 module");
  });
});

describe("Lucent packages", () => {
  it("builds the app's Lucent packages into its native package", () => {
    const root = project();
    fs.writeFileSync(path.join(root, "package.json"), JSON.stringify({ name: "app", dependencies: { "lucent-greet": "1.0.0" } }));
    const pkg = path.join(root, "node_modules/lucent-greet");
    fs.mkdirSync(path.join(pkg, "src"), { recursive: true });
    fs.writeFileSync(path.join(pkg, "package.json"), JSON.stringify({ name: "lucent-greet", version: "1.0.0", lucent: { sources: "src" } }));
    fs.writeFileSync(path.join(pkg, "src/greet.lucent.ts"), "export function hello(name: string): string { return `hi ${name}`; }\n");
    const r = lucent(root, "build");
    expect(r.status).toBe(0);
    expect(r.out).toMatch(/lucent-greet\/greet/);
    expect(fs.existsSync(path.join(root, ".lucent/native/js/lucent-greet/greet.js"))).toBe(true);
  });
});

describe("Lucent packages' native needs", () => {
  it("writes them into the native package, and names Info.plist keys the app lacks", () => {
    const root = project();
    fs.writeFileSync(path.join(root, "package.json"), JSON.stringify({ name: "app", dependencies: { "lucent-auth": "1.0.0" } }));
    const pkg = path.join(root, "node_modules/lucent-auth");
    fs.mkdirSync(path.join(pkg, "src"), { recursive: true });
    fs.writeFileSync(path.join(pkg, "package.json"), JSON.stringify({ name: "lucent-auth", version: "1.0.0", lucent: { sources: "src" } }));
    fs.writeFileSync(path.join(pkg, "lucent.json"), JSON.stringify({ ios: { pods: { LucentAuthKit: "~> 1.0" }, infoPlist: { NSFaceIDUsageDescription: "Unlock" } }, android: { dependencies: { "androidx.biometric:biometric": "1.1.0" } } }));
    fs.writeFileSync(path.join(pkg, "src/auth.lucent.ts"), "export function ok(): boolean { return true; }\n");
    fs.mkdirSync(path.join(root, "ios/App"), { recursive: true });
    fs.writeFileSync(path.join(root, "ios/App/Info.plist"), '<?xml version="1.0"?><plist version="1.0"><dict><key>CFBundleName</key><string>App</string></dict></plist>\n');
    const r = lucent(root, "build");
    expect(r.status).toBe(0);
    expect(fs.readFileSync(path.join(root, ".lucent/native/LucentNative.podspec"), "utf8")).toContain('s.dependency "LucentAuthKit", "~> 1.0"');
    expect(fs.readFileSync(path.join(root, ".lucent/native/android/build.gradle"), "utf8")).toContain('api("androidx.biometric:biometric:1.1.0")');
    // The app's files are not edited: the build says what to add.
    expect(r.out).toMatch(/lucent-auth needs NSFaceIDUsageDescription in ios\/App\/Info\.plist/);
    // lucent.json changes rebuild.
    fs.writeFileSync(path.join(pkg, "lucent.json"), JSON.stringify({ android: { dependencies: { "androidx.biometric:biometric": "1.2.0" } } }));
    expect(lucent(root, "build").out).not.toMatch(/up to date/);
    expect(fs.readFileSync(path.join(root, ".lucent/native/android/build.gradle"), "utf8")).toContain('api("androidx.biometric:biometric:1.2.0")');
  });
});

describe("lucent sdk coverage", () => {
  it.skipIf(!android)("reports idiomatic, raw and unrepresentable members per module, and fails when coverage drops", () => {
    const root = project();
    const cache = fs.mkdtempSync(path.join(os.tmpdir(), "lucent-cli-cache-"));
    const run = (...args: string[]) => spawnSync(process.execPath, [bin, "sdk", "coverage", ...args, "--root", root], { encoding: "utf8", env: { ...process.env, LUCENT_CACHE_DIR: cache } });
    const r = run("--android", "android.os", "--json");
    expect(r.status).toBe(0);
    const [os_] = JSON.parse(r.stdout) as { module: string; idiomatic: number; raw: number; unrepresentable: number; total: number }[];
    expect(os_).toMatchObject({ module: "android.os" });
    expect(os_!.idiomatic + os_!.raw + os_!.unrepresentable).toBe(os_!.total);
    expect(os_!.total).toBeGreaterThan(1000);
    // A baseline with a smaller unrepresentable share than now: coverage dropped.
    // Shares, not counts, so CI's SDK version need not be this machine's.
    const baseline = path.join(root, "coverage.json");
    fs.writeFileSync(baseline, JSON.stringify([{ ...os_, unrepresentable: 0 }]));
    const check = run("--android", "android.os", "--check", baseline);
    expect(check.status).toBe(1);
    expect(check.stderr).toMatch(/android\.os: .*% unrepresentable, .*% in the baseline/);
    fs.writeFileSync(baseline, JSON.stringify([{ ...os_, unrepresentable: os_!.unrepresentable * 2, total: os_!.total * 2 }]));
    expect(run("--android", "android.os", "--check", baseline).status).toBe(0);
    // Every package with a prefix.
    const all = JSON.parse(run("--android", "android.os.*", "--json").stdout) as { module: string }[];
    expect(all.length).toBeGreaterThan(3);
    expect(all.every((c) => c.module.startsWith("android.os."))).toBe(true);
  });
});

describe("lucent init", () => {
  it("links the native package as the `lucent` dependency", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "lucent-init-"));
    expect(lucent(root, "init").status).toBe(0);
    const config = fs.readFileSync(path.join(root, "react-native.config.js"), "utf8");
    expect(config).toContain('"lucent": { root: require("path").join(__dirname, ".lucent", "native") }');
    expect(config).not.toContain("lucent-native");
  });

  it("renames an existing `lucent-native` entry", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "lucent-init-"));
    fs.writeFileSync(path.join(root, "react-native.config.js"), 'module.exports = { dependencies: { "lucent-native": { root: ".lucent/native" } } };\n');
    expect(lucent(root, "init").status).toBe(0);
    expect(fs.readFileSync(path.join(root, "react-native.config.js"), "utf8")).toBe('module.exports = { dependencies: { "lucent": { root: ".lucent/native" } } };\n');
  });
});

describe.skipIf(!android)("lucent sdk prefetch", () => {
  const run = (root: string, env: Record<string, string>, ...args: string[]) => {
    const r = spawnSync(process.execPath, [bin, ...args, "--root", root], { encoding: "utf8", env: { ...process.env, ...env } });
    return { status: r.status, out: r.stdout + r.stderr };
  };

  it("extracts the modules it is given into the cache", () => {
    const cache = fs.mkdtempSync(path.join(os.tmpdir(), "lucent-cli-cache-"));
    const r = run(project(), { LUCENT_CACHE_DIR: cache }, "sdk", "prefetch", "--android", "android.os");
    expect(r.out).toMatch(/android\.os/);
    expect(r.status).toBe(0);
    const [key] = fs.readdirSync(path.join(cache, "sdk/android"));
    expect(fs.existsSync(path.join(cache, "sdk/android", key!, "android.os.json"))).toBe(true);
  });

  it("fails for modules the SDK does not have, saying where it looked", () => {
    const r = run(project(), { LUCENT_CACHE_DIR: fs.mkdtempSync(path.join(os.tmpdir(), "lucent-cli-cache-")) }, "sdk", "prefetch", "--android", "com.nope");
    expect(r.status).toBe(1);
    expect(r.out).toMatch(/com\.nope.*not found/s);
  });

  it("builds the platforms whose SDK is installed, and says which it skipped", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "lucent-cli-"));
    fs.writeFileSync(path.join(root, "m.lucent.ts"), "export declare function f(): Promise<string>;\n");
    fs.writeFileSync(path.join(root, "m.ios.lucent.ts"), 'import { UIDevice } from "lucent:ios/UIKit";\nimport { main } from "lucent:thread";\nexport function f(): Promise<string> { return main(() => UIDevice.current.model); }\n');
    fs.writeFileSync(path.join(root, "m.android.lucent.ts"), 'import { Build } from "lucent:android/android.os";\nexport async function f(): Promise<string> { return Build.MODEL ?? ""; }\n');
    const r = run(root, { LUCENT_XCRUN: path.join(os.tmpdir(), "no-such-xcrun"), LUCENT_CACHE_DIR: fs.mkdtempSync(path.join(os.tmpdir(), "lucent-cli-cache-")) }, "build");
    expect(r.out).toMatch(/iOS SDK was not found.*skipped iOS/s);
    expect(r.status).toBe(0);
    expect(fs.existsSync(path.join(root, ".lucent/native/cpp/generated/android/m_m.cpp"))).toBe(true);
    expect(fs.existsSync(path.join(root, ".lucent/native/cpp/generated/ios"))).toBe(false);
  });

  it("says which platforms it skipped for a module that branches on PLATFORM too", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "lucent-cli-"));
    fs.writeFileSync(
      path.join(root, "m.lucent.ts"),
      'import { PLATFORM } from "lucent:platform";\nimport { UIDevice } from "lucent:ios/UIKit";\nimport { Build } from "lucent:android/android.os";\nimport { main } from "lucent:thread";\nexport async function f(): Promise<string> {\n  if (PLATFORM === "ios") return main(() => UIDevice.current.model);\n  else return Build.MODEL ?? "";\n}\n',
    );
    const r = run(root, { LUCENT_XCRUN: path.join(os.tmpdir(), "no-such-xcrun"), LUCENT_CACHE_DIR: fs.mkdtempSync(path.join(os.tmpdir(), "lucent-cli-cache-")) }, "build");
    expect(r.out).toMatch(/iOS SDK was not found.*skipped iOS/s);
    expect(r.status).toBe(0);
    expect(fs.existsSync(path.join(root, ".lucent/native/cpp/generated/android/m_m.cpp"))).toBe(true);
  });
});

describe("the app's Android dependencies", () => {
  it("lucent init leaves the app's Gradle files alone", () => {
    const root = project();
    fs.mkdirSync(path.join(root, "android/app"), { recursive: true });
    const gradle = 'apply plugin: "com.android.application"\n';
    fs.writeFileSync(path.join(root, "android/app/build.gradle"), gradle);
    lucent(root, "init");
    expect(fs.readFileSync(path.join(root, "android/app/build.gradle"), "utf8")).toBe(gradle);
  });

  it.skipIf(!android)("lucent build resolves them with Gradle when an import is not in the SDK", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "lucent-cli-"));
    fs.writeFileSync(path.join(root, "m.lucent.ts"), "export declare function f(): Promise<string>;\n");
    fs.writeFileSync(path.join(root, "m.android.lucent.ts"), 'import { Widget } from "lucent:android/com.example.widgets";\nexport async function f(): Promise<string> { return new Widget().getName(); }\n');
    fs.writeFileSync(path.join(root, "m.ios.lucent.ts"), 'export async function f(): Promise<string> { return ""; }\n');
    // A stand-in gradlew: records the call and writes the classpath with a fixture jar.
    const jar = path.join(root, "widgets.jar");
    const classes = path.join(root, "classes");
    const sources = spawnSync("find", [path.join(path.dirname(bin), "../../bindgen/test/fixtures/java"), "-name", "*.java"], { encoding: "utf8" }).stdout.trim().split("\n");
    spawnSync("javac", ["--release", "11", "-d", classes, ...sources]);
    spawnSync("jar", ["cf", jar, "-C", classes, "."]);
    fs.mkdirSync(path.join(root, "android"));
    fs.writeFileSync(path.join(root, "android/gradlew"), `#!/bin/sh\necho "$@" > ${path.join(root, "gradle-args")}\nmkdir -p ${path.join(root, ".lucent")}\necho '{"jars":["${jar}"],"aars":[]}' > ${path.join(root, ".lucent/android-classpath.json")}\n`, { mode: 0o755 });
    const r = spawnSync(process.execPath, [bin, "build", "--platforms", "android", "--root", root], { encoding: "utf8", env: { ...process.env, LUCENT_CACHE_DIR: fs.mkdtempSync(path.join(os.tmpdir(), "lucent-cli-cache-")) } });
    expect(r.stdout + r.stderr).toMatch(/resolving the app's Android dependencies/);
    // The task comes from an init script Lucent ships: nothing in the app applies it.
    const args = fs.readFileSync(path.join(root, "gradle-args"), "utf8").trim().split(/\s+/);
    const script = args[args.indexOf("--init-script") + 1]!;
    expect(fs.readFileSync(script, "utf8")).toMatch(/lucentClasspath/);
    expect(args).toContain(":app:lucentClasspath");
    expect(fs.existsSync(path.join(root, ".lucent/native/android/lucent.gradle"))).toBe(false);
    expect(r.status).toBe(0);
  });

  /** An app with an Android import no dependency has, and a gradlew that counts its runs. */
  function gradleApp(exitCode = 0) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "lucent-cli-"));
    fs.writeFileSync(path.join(root, "m.lucent.ts"), "export declare function f(): Promise<string>;\n");
    fs.writeFileSync(path.join(root, "m.android.lucent.ts"), 'import { Nope } from "lucent:android/com.example.nope";\nexport async function f(): Promise<string> { return `${Nope}`; }\n');
    fs.writeFileSync(path.join(root, "m.ios.lucent.ts"), 'export async function f(): Promise<string> { return ""; }\n');
    fs.writeFileSync(path.join(root, "package-lock.json"), "{}\n");
    fs.mkdirSync(path.join(root, "android/app"), { recursive: true });
    fs.mkdirSync(path.join(root, "android/gradle"), { recursive: true });
    fs.writeFileSync(path.join(root, "android/app/build.gradle"), 'apply plugin: "com.android.application"\n');
    fs.writeFileSync(path.join(root, "android/gradle/libs.versions.toml"), "[versions]\n");
    const runs = path.join(root, "gradle-runs");
    fs.writeFileSync(path.join(root, "android/gradlew"), `#!/bin/sh\necho run >> ${runs}\nmkdir -p ${path.join(root, ".lucent")}\necho '{"jars":[],"aars":[]}' > ${path.join(root, ".lucent/android-classpath.json")}\nexit ${exitCode}\n`, { mode: 0o755 });
    const cache = fs.mkdtempSync(path.join(os.tmpdir(), "lucent-cli-cache-"));
    const build = () => spawnSync(process.execPath, [bin, "build", "--platforms", "android", "--root", root], { encoding: "utf8", env: { ...process.env, LUCENT_CACHE_DIR: cache } });
    const count = () => (fs.existsSync(runs) ? fs.readFileSync(runs, "utf8").trim().split("\n").length : 0);
    return { root, build, count, cache };
  }

  it.skipIf(!android)("runs Gradle once per change of the build's inputs, not once per build", () => {
    const app = gradleApp();
    app.build();
    app.build();
    expect(app.count()).toBe(1);
    // The JS lockfile: autolinked packages add Android dependencies.
    fs.writeFileSync(path.join(app.root, "package-lock.json"), '{"lockfileVersion":3}\n');
    app.build();
    app.build();
    expect(app.count()).toBe(2);
    fs.writeFileSync(path.join(app.root, "android/gradle/libs.versions.toml"), '[versions]\nbiometric = "1.1.0"\n');
    app.build();
    expect(app.count()).toBe(3);
  });

  it("does not run Gradle for a host build, which needs no SDK", () => {
    const app = gradleApp();
    const r = spawnSync(process.execPath, [bin, "build", "--platforms", "host", "--root", app.root], { encoding: "utf8", env: { ...process.env, LUCENT_CACHE_DIR: app.cache, LUCENT_ANDROID_PLATFORM: "nope", LUCENT_XCRUN: "/nonexistent" } });
    expect(r.stdout + r.stderr).not.toMatch(/resolving the app's Android dependencies/);
    expect(app.count()).toBe(0);
    expect(r.status).toBe(0);
  });

  it.skipIf(!android)("does not retry a failed resolution until the inputs change", () => {
    const app = gradleApp(1);
    expect(app.build().stderr).toMatch(/Gradle could not resolve/);
    app.build();
    expect(app.count()).toBe(1);
    fs.writeFileSync(path.join(app.root, "android/app/build.gradle"), 'apply plugin: "com.android.application"\n// fixed\n');
    app.build();
    expect(app.count()).toBe(2);
    // A failure that was not the build files' (a stopped daemon, the network): --force retries.
    expect(app.build().stderr).toMatch(/--force/);
    spawnSync(process.execPath, [bin, "build", "--force", "--platforms", "android", "--root", app.root], { encoding: "utf8", env: { ...process.env, LUCENT_CACHE_DIR: app.cache } });
    expect(app.count()).toBe(3);
  });

  it.skipIf(!android)("resolves once in a watch session that rebuilds", async () => {
    const app = gradleApp();
    const child = spawn(process.execPath, [bin, "build", "--watch", "--root", app.root], { env: { ...process.env, LUCENT_CACHE_DIR: app.cache } });
    let output = "";
    child.stdout.on("data", (d) => (output += String(d)));
    child.stderr.on("data", (d) => (output += String(d)));
    const builds = () => (output.match(/Lucent build failed|✓ Lucent:/g) ?? []).length;
    const until = async (n: number) => {
      for (let i = 0; i < 300 && builds() < n; i++) await new Promise((r) => setTimeout(r, 100));
    };
    await until(1);
    fs.appendFileSync(path.join(app.root, "m.android.lucent.ts"), "// edited\n");
    await until(2);
    child.kill();
    expect(builds()).toBeGreaterThanOrEqual(2);
    expect(app.count()).toBe(1);
  }, 60_000);
});
