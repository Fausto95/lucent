import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it, vi } from "vite-plus/test";
import { podsSearchPaths } from "../src/pods.ts";
import {
  extractionCount,
  forgetLoadedSdks,
  sdkAvailable,
  sdkModule,
  sdkNames,
} from "../src/provider.ts";
import { parseSchemaType, SCHEMA_FORMAT } from "../src/schema.ts";
import { schemaFiles } from "./cache-files.ts";
import { swiftModule } from "./swift-module.ts";
import { runJar, runJavac } from "./jvm-tools.ts";

/** A schema type from its written form (`string?`, `Widgets.WDGWidget`). */
const T = (s: string, typeParams: string[] = []) => parseSchemaType(s, "", typeParams);

const fixtures = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures");
const javac =
  spawnSync("javac", ["-version"]).status === 0 && spawnSync("jar", ["--version"]).status === 0;
const xcode = sdkAvailable("ios");
const androidSdk = sdkAvailable("android");

function fixtureJar(dir: string): string {
  const sources = spawnSync("find", [path.join(fixtures, "java"), "-name", "*.java"], {
    encoding: "utf8",
  })
    .stdout.trim()
    .split("\n");
  const classes = path.join(dir, "classes");
  const cc = runJavac(["--release", "11", "-d", classes, ...sources]);
  if (cc.status !== 0) throw new Error(cc.stderr);
  const jar = path.join(dir, "fixture.jar");
  runJar(["cf", jar, "-C", classes, "."]);
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
    expect(
      schemaFiles(path.join(cacheDir, "sdk/android", cached[0]!), "com.example.widgets"),
    ).toHaveLength(1);

    // A new process: nothing in memory, the cache on disk.
    forgetLoadedSdks();
    const warm = sdkModule("android", "com.example.widgets", opts);
    expect(warm).toEqual(cold);
    expect(extractionCount()).toBe(before + 1);
  });

  it("writes schemas in the current format, and extracts again over another format", () => {
    const cacheDir = tmp("lucent-cache-");
    const jar = fixtureJar(tmp("lucent-jar-"));
    const opts = { cacheDir, android: { jars: [jar] } };

    const cold = sdkModule("android", "com.example.widgets", opts);
    expect("schema" in cold && cold.schema.format).toBe(SCHEMA_FORMAT);

    // A schema an older Lucent wrote: a cache miss, never an error.
    const [file] = schemaFiles(cacheDir, "com.example.widgets");
    const entry = JSON.parse(fs.readFileSync(file!, "utf8"));
    fs.writeFileSync(file!, JSON.stringify({ ...entry, schema: { ...entry.schema, format: 0 } }));
    forgetLoadedSdks();
    const before = extractionCount();

    const again = sdkModule("android", "com.example.widgets", opts);

    expect(extractionCount()).toBe(before + 1);
    expect("schema" in again && again.schema.format).toBe(SCHEMA_FORMAT);
    expect(JSON.parse(fs.readFileSync(file!, "utf8")).schema.format).toBe(SCHEMA_FORMAT);
  });

  it("extracts again when the jar's classes change, not its times or other files", () => {
    const cacheDir = tmp("lucent-cache-");
    const dir = tmp("lucent-jar-");
    const jar = fixtureJar(dir);
    const opts = { cacheDir, android: { jars: [jar] } };
    sdkModule("android", "com.example.widgets", opts);
    const before = extractionCount();

    // The same jar, written again.
    fs.utimesSync(jar, new Date(), new Date(Date.now() + 60_000));
    forgetLoadedSdks();
    sdkModule("android", "com.example.widgets", opts);
    expect(extractionCount()).toBe(before);

    // Other contents that declare nothing: the same declarations.
    fs.writeFileSync(path.join(dir, "NOTICE"), "rebuilt\n");
    runJar(["uf", jar, "-C", dir, "NOTICE"]);
    forgetLoadedSdks();
    sdkModule("android", "com.example.widgets", opts);
    expect(extractionCount()).toBe(before);

    // Another jar: a class more.
    const extra = path.join(dir, "extra");
    fs.mkdirSync(path.join(extra, "com/example/widgets"), { recursive: true });
    fs.writeFileSync(
      path.join(extra, "com/example/widgets/Extra.java"),
      "package com.example.widgets; public class Extra {}",
    );
    runJavac(["--release", "11", path.join(extra, "com/example/widgets/Extra.java")]);
    runJar(["uf", jar, "-C", extra, "com/example/widgets/Extra.class"]);
    forgetLoadedSdks();
    sdkModule("android", "com.example.widgets", opts);
    expect(extractionCount()).toBe(before + 1);
  });

  it("says where it looked for a module it cannot find", () => {
    const jar = fixtureJar(tmp("lucent-jar-"));
    const r = sdkModule("android", "com.example.nope", {
      cacheDir: tmp("lucent-cache-"),
      android: { jars: [jar] },
    });
    expect(r).toEqual({
      missing: expect.stringMatching(/com\.example\.nope.*not found.*fixture\.jar/s),
    });
  });

  it.skipIf(!androidSdk)(
    "binds the app's dependencies: jars and AARs on its resolved classpath",
    () => {
      const dir = tmp("lucent-deps-");
      const jar = fixtureJar(dir);
      // An AAR: classes.jar inside a zip, as Gradle downloads them.
      const aarDir = path.join(dir, "aar");
      fs.mkdirSync(aarDir);
      fs.copyFileSync(jar, path.join(aarDir, "classes.jar"));
      fs.writeFileSync(path.join(aarDir, "AndroidManifest.xml"), "<manifest/>");
      const aar = path.join(dir, "widgets.aar");
      runJar(["cf", aar, "-C", aarDir, "."]);
      const classpath = path.join(dir, "android-classpath.json");
      fs.writeFileSync(classpath, JSON.stringify({ aars: [aar], jars: [] }));
      const sdk = { cacheDir: tmp("lucent-cache-"), android: { classpath } };
      const r = sdkModule("android", "com.example.widgets", sdk);
      expect("schema" in r && r.schema.types.some((t) => t.name === "Widget")).toBe(true);
      // Where it looked, when a package is in neither.
      expect(sdkModule("android", "com.example.nope", sdk)).toEqual({
        missing: expect.stringMatching(
          /not found in the SDK or the app's dependencies.*android\.jar.*1 dependency/s,
        ),
      });
    },
  );

  it.skipIf(!androidSdk)("binds the libraries Lucent packages ship, beside the classpath", () => {
    const dir = tmp("lucent-libraries-");
    const jar = fixtureJar(dir);
    const sdk = { cacheDir: tmp("lucent-cache-"), android: { libraries: [jar] } };

    const r = sdkModule("android", "com.example.widgets", sdk);
    expect("schema" in r && r.schema.types.some((t) => t.name === "Widget")).toBe(true);
    expect("schema" in r && r.schema.provenance?.artifact).toBe("jar:fixture.jar");
  });

  it.skipIf(!androidSdk)("says how to resolve the app's dependencies when it has not", () => {
    const r = sdkModule("android", "androidx.biometric", {
      cacheDir: tmp("lucent-cache-"),
      android: { classpath: path.join(tmp("lucent-app-"), ".lucent/android-classpath.json") },
    });
    expect(r).toEqual({
      missing: expect.stringMatching(/androidx\.biometric.*not found.*lucentClasspath/s),
    });
  });

  it("names the fix when there is no Android SDK", () => {
    const r = sdkModule("android", "android.os", {
      cacheDir: tmp("lucent-cache-"),
      android: { sdkRoots: [path.join(os.tmpdir(), "no-such-android-sdk")] },
    });
    expect(r).toEqual({ missing: expect.stringMatching(/Android SDK.*not found.*ANDROID_HOME/s) });
  });
});

describe.skipIf(!xcode)("SDK modules on demand: iOS", () => {
  // A cold cache on purpose: the SDK modules it names are extracted too, minutes on CI.
  it("extracts a module on first use and caches it per Xcode", () => {
    const cacheDir = tmp("lucent-cache-");
    const opts = { cacheDir, ios: { includePaths: [path.join(fixtures, "objc")] } };
    const before = extractionCount();
    const cold = sdkModule("ios", "Widgets", opts);
    expect("schema" in cold && cold.schema.types.some((t) => t.name === "WDGWidget")).toBe(true);
    expect("schema" in cold && cold.schema.format).toBe(SCHEMA_FORMAT);
    expect("schema" in cold && cold.schema.provenance).toEqual({
      artifact: "clang-module:Widgets",
      kind: "clang-module",
      target: "arm64-apple-ios15.1-simulator",
      contentHash: expect.stringMatching(/^[0-9a-f]{16}$/),
      extractor: expect.stringMatching(/^[0-9a-f]{8}$/),
    });
    expect(extractionCount()).toBeGreaterThan(before);
    const [key] = fs.readdirSync(path.join(cacheDir, "sdk/ios"));
    // The key names the SDK version and the Xcode build.
    expect(key).toMatch(/^iphonesimulator\d+\.\d+-\w+-[0-9a-f]+$/);
    forgetLoadedSdks();
    const after = extractionCount();
    expect(sdkModule("ios", "Widgets", opts)).toEqual(cold);
    expect(extractionCount()).toBe(after);
  }, 600_000);

  // A cold cache on purpose: the SDK modules it names are extracted too, minutes on CI.
  it("gives modules a program does not import only the names of their types", () => {
    const cacheDir = tmp("lucent-cache-");
    const opts = { cacheDir, ios: { includePaths: [path.join(fixtures, "objc")] } };
    const names = sdkNames("ios", "Widgets", opts);
    expect("names" in names && names.names.types.WDGWidget).toEqual({
      kind: "class",
      native: "WDGWidget",
      inherits: "c:objc(cs)NSObject",
      conforms: ["c:objc(pl)NSObject", "c:objc(pl)WDGShape"],
    });
    // A protocol's requirements, for classes of other modules that adopt it.
    expect("names" in names && names.names.types.WDGFramed?.requires).toEqual(["m:level"]);

    // A struct without fields is not declared: other modules must not name it.
    expect("names" in names && names.names.types.WDGEmpty).toBeUndefined();
    expect("names" in names && names.names.types.WDGShape).toEqual({
      kind: "protocol",
      native: "WDGShape",
      requires: ["m:area"],
    });
    expect("names" in names && names.names.types.WDGStyle).toEqual({
      kind: "enum",
      native: "WDGStyle",
    });
    // Structs keep their fields: other modules' signatures pass them by value.
    const measures = sdkNames("ios", "Measures", opts);
    expect("names" in measures && measures.names.types.MSRSpan).toEqual({
      kind: "struct",
      native: "MSRSpan",
      fields: [
        { name: "start", type: T("Measures.MSRTime") },
        { name: "duration", type: T("Measures.MSRTime") },
      ],
    });
    // Names come from the symbol graph alone: no schema is built.
    const [key] = fs.readdirSync(path.join(cacheDir, "sdk/ios"));
    expect(fs.existsSync(path.join(cacheDir, "sdk/ios", key!, "Widgets.json"))).toBe(false);
  }, 600_000);

  // From here, the shared SDK cache, as an app's builds use it: what these bind is cached by its
  // content, and the SDK's modules are extracted once rather than for each test.
  it("binds pods: module maps and search paths from the Pods xcconfig", () => {
    const pods = podsSearchPaths(path.join(fixtures, "pods"));
    const root = path.join(fixtures, "pods/Pods");
    expect(pods).toEqual({
      includePaths: [
        path.join(root, "Headers/Public"),
        path.join(root, "Headers/Public/WidgetsPod"),
      ],
      frameworkPaths: [],
      moduleMaps: [path.join(root, "Headers/Public/WidgetsPod/WidgetsPod.modulemap")],
      frameworks: [],
      defines: ["COCOAPODS=1"],
      lockfile: path.join(fixtures, "pods/Podfile.lock"),
    });
    const r = sdkModule("ios", "WidgetsPod", { ios: pods });
    // Imported through the umbrella header its module map names, as <Pod/…>;
    // linked by the pod itself, not as a framework.
    expect("schema" in r && { header: r.schema.header, frameworks: r.schema.frameworks }).toEqual({
      header: "WidgetsPod/WidgetsPod-umbrella.h",
      frameworks: [],
    });
    // The pod and version Podfile.lock installed.
    expect("schema" in r && r.schema.provenance).toMatchObject({
      artifact: "pod:WidgetsPod@1.0.0",
      kind: "clang-module",
      contentHash: expect.stringMatching(/^[0-9a-f]{16}$/),
    });
    expect("schema" in r && r.schema.types.find((t) => t.name === "WPGaugeMode")).toMatchObject({
      cases: [
        { name: "linear", value: 0 },
        { name: "radial", value: 4 },
      ],
    });
    // A Foundation type in its signatures: the SDK and the pods, together.
    const gauge = "schema" in r ? r.schema.types.find((t) => t.name === "WPGauge") : undefined;
    expect(
      gauge?.kind === "class" && gauge.properties?.find((p) => p.name === "documentation")?.type,
    ).toEqual(T("Foundation.NSURL"));
  });

  it("resolves structs and typedefs other modules declare, attributes and tags included", () => {
    const r = sdkModule("ios", "Players", {
      ios: { includePaths: [path.join(fixtures, "objc")] },
    });
    const player = "schema" in r ? r.schema.types.find((t) => t.name === "PLYPlayer") : undefined;
    const type = (name: string) =>
      player?.kind === "class" ? player.properties?.find((p) => p.name === name)?.type : undefined;
    expect(type("currentTime")).toEqual(T("Measures.MSRTime"));
    expect(type("loop")).toEqual(T("Measures.MSRSpan"));
    expect(type("track")).toEqual(T("int32"));
    // Swift hides the tag `_MSRRange` and names the typedef without a USR, as it does NSRange.
    expect(type("selection")).toEqual(T("Measures.MSRRange"));
    const measures = sdkModule("ios", "Measures", {
      ios: { includePaths: [path.join(fixtures, "objc")] },
    });
    expect(
      "schema" in measures && measures.schema.types.find((t) => t.name === "MSRRange"),
    ).toEqual({
      kind: "struct",
      name: "MSRRange",
      native: "MSRRange",
      symbol: "c:c:Measures.h@T@MSRRange",
      fields: [
        { name: "location", type: T("NSUInteger") },
        { name: "length", type: T("NSUInteger") },
      ],
    });
  });

  it("binds Swift's value types as the Objective-C classes they bridge to", () => {
    const r = sdkModule("ios", "Players", {
      ios: { includePaths: [path.join(fixtures, "objc")] },
    });
    const player = "schema" in r ? r.schema.types.find((t) => t.name === "PLYPlayer") : undefined;
    // Swift says IndexPath and URLRequest; Foundation's ReferenceConvertible names the classes.
    expect(
      player?.kind === "class" && player.properties?.find((p) => p.name === "position")?.type,
    ).toEqual(T("Foundation.NSIndexPath"));
    expect(
      player?.kind === "class" &&
        player.methods?.find((m) => m.selector === "openRequest:")?.params,
    ).toEqual([{ name: "request", type: T("Foundation.NSURLRequest") }]);
  });

  it("binds opaque CoreFoundation-style handles as classes of their C type", () => {
    const opts = {
      ios: { includePaths: [path.join(fixtures, "objc")] },
    };
    const names = sdkNames("ios", "Measures", opts);
    expect("names" in names && names.names.types.MSRBuffer).toEqual({
      kind: "class",
      native: "MSRBufferRef",
      cf: true,
    });
    const measures = sdkModule("ios", "Measures", opts);
    const schema = "schema" in measures ? measures.schema : undefined;
    expect(schema?.types.find((t) => t.name === "MSRBuffer")).toEqual({
      kind: "class",
      name: "MSRBuffer",
      native: "MSRBufferRef",
      cf: true,
      symbol: "c:c:Measures.h@T@MSRBufferRef",
    });
    expect(schema?.functions?.find((f) => f.name === "MSRBufferCreate")?.returns).toEqual(
      T("Measures.MSRBuffer?"),
    );
    expect(schema?.functions?.find((f) => f.name === "MSRBufferGetSize")?.params).toEqual([
      { name: "buffer", type: T("Measures.MSRBuffer") },
    ]);
    const players = sdkModule("ios", "Players", opts);
    const player =
      "schema" in players ? players.schema.types.find((t) => t.name === "PLYPlayer") : undefined;
    expect(
      player?.kind === "class" && player.properties?.find((p) => p.name === "buffer")?.type,
    ).toEqual(T("Measures.MSRBuffer?"));
  });

  it("binds NSSet as a set of its element type", () => {
    const r = sdkModule("ios", "Players", {
      ios: { includePaths: [path.join(fixtures, "objc")] },
    });
    const player = "schema" in r ? r.schema.types.find((t) => t.name === "PLYPlayer") : undefined;
    expect(
      player?.kind === "class" && player.properties?.find((p) => p.name === "tags")?.type,
    ).toEqual(T("Set<string>"));
    expect(
      player?.kind === "class" &&
        player.methods?.find((m) => m.selector === "followPlayers:")?.params,
    ).toEqual([{ name: "players", type: T("Set<Players.PLYPlayer>") }]);
  });

  it("binds AnyHashable (untyped NSDictionary keys, NSSet elements) as id", () => {
    const r = sdkModule("ios", "Players", {
      ios: { includePaths: [path.join(fixtures, "objc")] },
    });
    const player = "schema" in r ? r.schema.types.find((t) => t.name === "PLYPlayer") : undefined;
    // Keys that are not strings are left out when read, as JavaScript objects' are.
    expect(
      player?.kind === "class" && player.properties?.find((p) => p.name === "info")?.type,
    ).toEqual(T("Record<id>"));
    expect(
      player?.kind === "class" &&
        player.methods?.find((m) => m.selector === "markObjects:")?.params,
    ).toEqual([{ name: "objects", type: T("Set<id>") }]);
  });

  it("imports and links an SDK module as its framework", () => {
    const r = sdkModule("ios", "Security");
    expect("schema" in r && { header: r.schema.header, frameworks: r.schema.frameworks }).toEqual({
      header: "Security/Security.h",
      frameworks: ["Security"],
    });

    // The SDK is the artifact: its version names it.
    const version = spawnSync("xcrun", ["--sdk", "iphonesimulator", "--show-sdk-version"], {
      encoding: "utf8",
    }).stdout.trim();
    expect("schema" in r && r.schema.provenance).toEqual({
      artifact: `sdk:iphonesimulator${version}`,
      kind: "sdk",
      target: "arm64-apple-ios15.1-simulator",
      extractor: expect.stringMatching(/^[0-9a-f]{8}$/),
    });
  });

  it("imports an SDK framework through the umbrella header its module map names", () => {
    const r = sdkModule("ios", "_LocationEssentials");
    expect("schema" in r && r.schema.header).toBe("_LocationEssentials/LocationEssentials.h");
  });

  it("binds Swift modules: on the include paths, and SDK frameworks without headers", () => {
    const opts = { ios: { includePaths: [swiftModule("Shapes")] } };
    const shapes = sdkModule("ios", "Shapes", opts);
    // Nothing to import (the shims call them) and, as the app's own, nothing to link.
    expect(
      "schema" in shapes && {
        header: shapes.schema.header,
        frameworks: shapes.schema.frameworks,
        point: shapes.schema.types.find((t) => t.name === "Point")?.native,
      },
    ).toEqual({ header: undefined, frameworks: [], point: "Shapes.Point" });
    expect("schema" in shapes && shapes.schema.provenance).toMatchObject({
      artifact: "swift-module:Shapes",
      kind: "swift-module",
      contentHash: expect.stringMatching(/^[0-9a-f]{16}$/),
    });
    const crypto = sdkModule("ios", "CryptoKit");
    expect(
      "schema" in crypto && { header: crypto.schema.header, frameworks: crypto.schema.frameworks },
    ).toEqual({ header: undefined, frameworks: ["CryptoKit"] });
  });

  it("reads a module's names from the cache once, however often a build asks", () => {
    const opts = { cacheDir: tmp("lucent-cache-") };
    expect("names" in sdkNames("ios", "CoreFoundation", opts)).toBe(true);

    const read = vi.spyOn(fs, "readFileSync");
    try {
      for (let i = 0; i < 3; i++)
        expect("names" in sdkNames("ios", "CoreFoundation", opts)).toBe(true);

      const names = read.mock.calls.filter(([f]) => String(f).endsWith(".names.json"));
      expect(names).toHaveLength(0);
    } finally {
      read.mockRestore();
    }
  });

  it("asks xcrun about the SDK once, whatever else the options say", () => {
    const dir = tmp("lucent-xcrun-");
    const calls = path.join(dir, "calls");
    const xcrun = path.join(dir, "xcrun");
    fs.writeFileSync(xcrun, `#!/bin/sh\necho "$*" >> "${calls}"\nexec xcrun "$@"\n`, {
      mode: 0o755,
    });

    for (const cacheDir of [tmp("lucent-cache-"), tmp("lucent-cache-")])
      sdkModule("ios", "NoSuchPodModule", { cacheDir, ios: { xcrun } });

    const asked = fs.readFileSync(calls, "utf8").trim().split("\n");
    expect(asked.filter((a) => a.includes("--show-sdk-path"))).toHaveLength(1);
  });

  it("says to run pod install when it looked for a module without the app's pods", () => {
    const r = sdkModule("ios", "NoSuchPodModule", { cacheDir: tmp("lucent-cache-"), ios: {} });
    expect(r).toEqual({
      missing: expect.stringMatching(/NoSuchPodModule.*not found.*no pods.*run pod install/s),
    });
  });

  it("names the fix when there is no Xcode", () => {
    const r = sdkModule("ios", "UIKit", {
      cacheDir: tmp("lucent-cache-"),
      ios: { xcrun: path.join(os.tmpdir(), "no-such-xcrun") },
    });
    expect(r).toEqual({ missing: expect.stringMatching(/iOS SDK.*not found.*xcode-select/s) });
  });
});
