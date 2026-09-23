import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

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

describe("lucent sdk prefetch", () => {
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

  it("lucent build resolves them with Gradle when an import is not in the SDK", () => {
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
});
