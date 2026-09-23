import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { podsSearchPaths } from "../src/pods.ts";
import { extractionCount, forgetLoadedSdks, sdkAvailable, sdkModule, sdkNames } from "../src/provider.ts";

const fixtures = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures");
const javac = spawnSync("javac", ["-version"]).status === 0 && spawnSync("jar", ["--version"]).status === 0;
const xcode = sdkAvailable("ios", { prebuilt: false });
const androidSdk = sdkAvailable("android", { prebuilt: false });

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

  it.skipIf(!androidSdk)("binds the app's dependencies: jars and AARs on its resolved classpath", () => {
    const dir = tmp("lucent-deps-");
    const jar = fixtureJar(dir);
    // An AAR: classes.jar inside a zip, as Gradle downloads them.
    const aarDir = path.join(dir, "aar");
    fs.mkdirSync(aarDir);
    fs.copyFileSync(jar, path.join(aarDir, "classes.jar"));
    fs.writeFileSync(path.join(aarDir, "AndroidManifest.xml"), "<manifest/>");
    const aar = path.join(dir, "widgets.aar");
    spawnSync("jar", ["cf", aar, "-C", aarDir, "."]);
    const classpath = path.join(dir, "android-classpath.json");
    fs.writeFileSync(classpath, JSON.stringify({ aars: [aar], jars: [] }));
    const sdk = { cacheDir: tmp("lucent-cache-"), android: { classpath } };
    const r = sdkModule("android", "com.example.widgets", sdk);
    expect("schema" in r && r.schema.types.some((t) => t.name === "Widget")).toBe(true);
    // Where it looked, when a package is in neither.
    expect(sdkModule("android", "com.example.nope", sdk)).toEqual({ missing: expect.stringMatching(/not found in the SDK or the app's dependencies.*android\.jar.*1 dependency/s) });
  });

  it.skipIf(!androidSdk)("says how to resolve the app's dependencies when it has not", () => {
    const r = sdkModule("android", "androidx.biometric", { cacheDir: tmp("lucent-cache-"), android: { classpath: path.join(tmp("lucent-app-"), ".lucent/android-classpath.json") } });
    expect(r).toEqual({ missing: expect.stringMatching(/androidx\.biometric.*not found.*lucentClasspath/s) });
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

  it("binds pods: module maps and search paths from the Pods xcconfig", () => {
    const pods = podsSearchPaths(path.join(fixtures, "pods"));
    const root = path.join(fixtures, "pods/Pods");
    expect(pods).toEqual({
      includePaths: [path.join(root, "Headers/Public"), path.join(root, "Headers/Public/WidgetsPod")],
      frameworkPaths: [],
      moduleMaps: [path.join(root, "Headers/Public/WidgetsPod/WidgetsPod.modulemap")],
    });
    const r = sdkModule("ios", "WidgetsPod", { cacheDir: tmp("lucent-cache-"), ios: pods });
    // Imported through the umbrella header its module map names, as <Pod/…>;
    // linked by the pod itself, not as a framework.
    expect("schema" in r && { header: r.schema.header, frameworks: r.schema.frameworks }).toEqual({ header: "WidgetsPod/WidgetsPod-umbrella.h", frameworks: [] });
    expect("schema" in r && r.schema.types.find((t) => t.name === "WPGaugeMode")).toMatchObject({ cases: [{ name: "linear", value: 0 }, { name: "radial", value: 4 }] });
    // A Foundation type in its signatures: the SDK and the pods, together.
    const gauge = "schema" in r ? r.schema.types.find((t) => t.name === "WPGauge") : undefined;
    expect(gauge?.kind === "class" && gauge.properties?.find((p) => p.name === "documentation")?.type).toBe("Foundation.NSURL");
  });

  it("imports and links an SDK module as its framework", () => {
    const r = sdkModule("ios", "Security");
    expect("schema" in r && { header: r.schema.header, frameworks: r.schema.frameworks }).toEqual({ header: "Security/Security.h", frameworks: ["Security"] });
  });

  it("imports an SDK framework through the umbrella header its module map names", () => {
    const r = sdkModule("ios", "_LocationEssentials");
    expect("schema" in r && r.schema.header).toBe("_LocationEssentials/LocationEssentials.h");
  });

  it("names the fix when there is no Xcode", () => {
    const r = sdkModule("ios", "UIKit", { cacheDir: tmp("lucent-cache-"), ios: { xcrun: path.join(os.tmpdir(), "no-such-xcrun") }, prebuilt: false });
    expect(r).toEqual({ missing: expect.stringMatching(/iOS SDK.*not found.*xcode-select/s) });
  });
});
