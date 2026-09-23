import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { extractionCount, forgetLoadedSdks, sdkModule, sdkNames } from "../src/provider.ts";

const fixtures = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures");
const javac = spawnSync("javac", ["-version"]).status === 0 && spawnSync("jar", ["--version"]).status === 0;
const xcode = process.platform === "darwin" && spawnSync("xcrun", ["--sdk", "iphonesimulator", "--show-sdk-path"]).status === 0;

function fixtureJar(dir: string): string {
  const sources = spawnSync("find", [path.join(fixtures, "java"), "-name", "*.java"], { encoding: "utf8" }).stdout.trim().split("\n");
  const classes = path.join(dir, "classes");
  const cc = spawnSync("javac", ["--release", "11", "-d", classes, ...sources], { encoding: "utf8" });
  if (cc.status !== 0) throw new Error(cc.stderr);
  const jar = path.join(dir, "fixture.jar");
  spawnSync("jar", ["cf", jar, "-C", classes, "."]);
  return jar;
}

const made: string[] = [];
const tmp = (prefix: string) => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  made.push(d);
  return d;
};
afterAll(() => made.forEach((d) => fs.rmSync(d, { recursive: true, force: true })));

describe.skipIf(!javac)("SDK modules on demand: Android", () => {
  it("extracts a package on first use and caches it per SDK", () => {
    const cacheDir = tmp("lucent-cache-");
    const jar = fixtureJar(tmp("lucent-jar-"));
    const opts = { cacheDir, android: { jars: [jar] } };

    const before = extractionCount();
    const cold = sdkModule("android", "com.example.widgets", opts);
    expect("schema" in cold && cold.schema.types.some((t) => t.name === "Widget")).toBe(true);
    expect(extractionCount()).toBe(before + 1);
    const cached = fs.readdirSync(path.join(cacheDir, "sdk/android"));
    expect(cached).toHaveLength(1);
    expect(fs.existsSync(path.join(cacheDir, "sdk/android", cached[0]!, "com.example.widgets.json"))).toBe(true);

    // A new process: nothing in memory, the cache on disk.
    forgetLoadedSdks();
    const warm = sdkModule("android", "com.example.widgets", opts);
    expect(warm).toEqual(cold);
    expect(extractionCount()).toBe(before + 1);
  });

  it("extracts again when the SDK changes", () => {
    const cacheDir = tmp("lucent-cache-");
    const jar = fixtureJar(tmp("lucent-jar-"));
    sdkModule("android", "com.example.widgets", { cacheDir, android: { jars: [jar] } });
    const before = extractionCount();
    // Another SDK: the same jar, rebuilt.
    fs.appendFileSync(jar, Buffer.alloc(0));
    fs.utimesSync(jar, new Date(), new Date(Date.now() + 60_000));
    forgetLoadedSdks();
    sdkModule("android", "com.example.widgets", { cacheDir, android: { jars: [jar] } });
    expect(extractionCount()).toBe(before + 1);
    expect(fs.readdirSync(path.join(cacheDir, "sdk/android"))).toHaveLength(2);
  });

  it("says where it looked for a module it cannot find", () => {
    const jar = fixtureJar(tmp("lucent-jar-"));
    const r = sdkModule("android", "com.example.nope", { cacheDir: tmp("lucent-cache-"), android: { jars: [jar] } });
    expect(r).toEqual({ missing: expect.stringMatching(/com\.example\.nope.*not found.*fixture\.jar/s) });
  });

  it("names the fix when there is no Android SDK", () => {
    const r = sdkModule("android", "android.os", { cacheDir: tmp("lucent-cache-"), android: { sdkRoots: [path.join(os.tmpdir(), "no-such-android-sdk")] }, prebuilt: false });
    expect(r).toEqual({ missing: expect.stringMatching(/Android SDK.*not found.*ANDROID_HOME/s) });
  });
});

describe.skipIf(!xcode)("SDK modules on demand: iOS", () => {
  it("extracts a module on first use and caches it per Xcode", () => {
    const cacheDir = tmp("lucent-cache-");
    const opts = { cacheDir, ios: { includePaths: [path.join(fixtures, "objc")] } };
    const before = extractionCount();
    const cold = sdkModule("ios", "Widgets", opts);
    expect("schema" in cold && cold.schema.types.some((t) => t.name === "WDGWidget")).toBe(true);
    expect(extractionCount()).toBeGreaterThan(before);
    const [key] = fs.readdirSync(path.join(cacheDir, "sdk/ios"));
    // The key names the SDK version and the Xcode build.
    expect(key).toMatch(/^iphonesimulator\d+\.\d+-\w+-[0-9a-f]+$/);
    forgetLoadedSdks();
    const after = extractionCount();
    expect(sdkModule("ios", "Widgets", opts)).toEqual(cold);
    expect(extractionCount()).toBe(after);
  });

  it("gives modules a program does not import only the names of their types", () => {
    const cacheDir = tmp("lucent-cache-");
    const opts = { cacheDir, ios: { includePaths: [path.join(fixtures, "objc")] } };
    const names = sdkNames("ios", "Widgets", opts);
    expect("names" in names && names.names.types.WDGWidget).toEqual({ kind: "class", native: "WDGWidget" });
    expect("names" in names && names.names.types.WDGShape).toEqual({ kind: "protocol", native: "WDGShape" });
    expect("names" in names && names.names.types.WDGStyle).toEqual({ kind: "enum", native: "WDGStyle" });
    // Names come from the symbol graph alone: no schema is built.
    const [key] = fs.readdirSync(path.join(cacheDir, "sdk/ios"));
    expect(fs.existsSync(path.join(cacheDir, "sdk/ios", key!, "Widgets.json"))).toBe(false);
  });

  it("names the fix when there is no Xcode", () => {
    const r = sdkModule("ios", "UIKit", { cacheDir: tmp("lucent-cache-"), ios: { xcrun: path.join(os.tmpdir(), "no-such-xcrun") }, prebuilt: false });
    expect(r).toEqual({ missing: expect.stringMatching(/iOS SDK.*not found.*xcode-select/s) });
  });
});
