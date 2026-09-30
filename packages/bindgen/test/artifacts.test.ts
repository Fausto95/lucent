/**
 * The native artifacts a build links, as its build system resolved them:
 * what bindings are extracted from, and what their caches are keyed on.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vite-plus/test";
import { podsSearchPaths } from "../src/pods.ts";
import {
  forgetLoadedSdks,
  nativeArtifacts,
  sdkAvailable,
  sdkModule,
  sdkModuleArtifacts,
} from "../src/provider.ts";
import { classpathFile, fakeAndroidSdk, gradleCached, javac, javaJar } from "./java-fixtures.ts";

const fixtures = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures");
const xcode = sdkAvailable("ios");

const made: string[] = [];
const tmp = (prefix: string) => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  made.push(d);
  return d;
};
afterAll(() => made.forEach((d) => fs.rmSync(d, { recursive: true, force: true })));

const HEX = /^[0-9a-f]{16}$/;

function androidApp(root: string) {
  const sdkRoot = fakeAndroidSdk(path.join(root, "sdk"), "android-35", {
    "android/os/Build.java": "package android.os; public class Build { public Build() {} }",
  });
  const gradle = path.join(root, "gradle");
  const core = javaJar(gradleCached(gradle, "dev.orbit", "core", "1.0.0"), {
    "dev/orbit/core/Clock.java": "package dev.orbit.core; public class Clock { public Clock() {} }",
  });
  const tracking = javaJar(
    gradleCached(gradle, "dev.orbit", "tracking", "1.0.0"),
    {
      "dev/orbit/tracking/Tracker.java": `package dev.orbit.tracking;
public class Tracker { public Tracker() {} public dev.orbit.core.Clock clock() { return null; } }`,
    },
    [core],
  );
  const classpath = classpathFile(path.join(root, "app/.lucent/android-classpath.json"), [
    tracking,
    core,
  ]);

  return { sdkRoot, core, tracking, classpath };
}

describe.skipIf(!javac)("native artifacts: Android", () => {
  it("names the SDK platform and each library of the resolved classpath", () => {
    const app = androidApp(tmp("lucent-app-"));
    const opts = {
      cacheDir: tmp("lucent-cache-"),
      android: { sdkRoots: [app.sdkRoot], classpath: app.classpath },
    };

    const artifacts = nativeArtifacts("android", opts);

    expect(artifacts).toEqual([
      {
        id: "android-sdk:35",
        target: "android",
        kind: "sdk",
        contentHash: expect.stringMatching(HEX),
        targetTriple: "android-35",
        dependencies: [],
        modules: ["android.os"],
        declarationInputs: [path.join(app.sdkRoot, "platforms/android-35/android.jar")],
        includePaths: [],
        compilerArguments: [],
        origin: {
          package: "android-35",
          version: "35",
          buildFile: path.join(app.sdkRoot, "platforms/android-35/android.jar"),
        },
      },
      {
        id: "maven:dev.orbit:tracking:1.0.0",
        target: "android",
        kind: "jar",
        contentHash: expect.stringMatching(HEX),
        targetTriple: "android-35",
        dependencies: [],
        modules: ["dev.orbit.tracking"],
        declarationInputs: [app.tracking],
        includePaths: [],
        compilerArguments: [],
        origin: { package: "dev.orbit:tracking", version: "1.0.0", buildFile: app.classpath },
      },
      expect.objectContaining({ id: "maven:dev.orbit:core:1.0.0", modules: ["dev.orbit.core"] }),
    ]);
  });

  it("identifies artifacts by what they declare, wherever their files are", () => {
    const here = tmp("lucent-app-");
    const app = androidApp(here);
    const identity = (sdkRoot: string, classpath: string) => {
      const found = nativeArtifacts("android", {
        cacheDir: tmp("lucent-cache-"),
        android: { sdkRoots: [sdkRoot], classpath },
      });
      return "missing" in found ? found : found.map((a) => [a.id, a.contentHash]);
    };

    // The same SDK and Gradle cache on another machine.
    const there = tmp("lucent-app-");
    fs.cpSync(here, there, { recursive: true });
    const at = (f: string) => path.join(there, path.relative(here, f));
    classpathFile(at(app.classpath), [at(app.tracking), at(app.core)]);

    // The libraries built again from the same sources: other zip timestamps, the same classes.
    const rebuilt = androidApp(tmp("lucent-app-"));

    expect(identity(at(app.sdkRoot), at(app.classpath))).toEqual(
      identity(app.sdkRoot, app.classpath),
    );
    expect(identity(rebuilt.sdkRoot, rebuilt.classpath)).toEqual(
      identity(app.sdkRoot, app.classpath),
    );
  });

  it("names the artifacts a package's schema was read from", () => {
    const app = androidApp(tmp("lucent-app-"));
    const opts = {
      cacheDir: tmp("lucent-cache-"),
      android: { sdkRoots: [app.sdkRoot], classpath: app.classpath },
    };

    sdkModule("android", "dev.orbit.tracking", opts);
    const read = sdkModuleArtifacts("android", "dev.orbit.tracking", opts).map((a) => a.id);

    // Its own library, the one declaring the Clock it returns, and the SDK: not the rest.
    expect(read).toEqual([
      "android-sdk:35",
      "maven:dev.orbit:core:1.0.0",
      "maven:dev.orbit:tracking:1.0.0",
    ]);
  });
});

describe.skipIf(!xcode)("native artifacts: iOS", () => {
  function pods() {
    const dir = tmp("lucent-pods-");
    fs.cpSync(path.join(fixtures, "pods"), dir, { recursive: true });

    // WidgetsPod depends on GaugeCore, which declares no module.
    fs.writeFileSync(
      path.join(dir, "Podfile.lock"),
      `PODS:
  - GaugeCore (2.1.0)
  - WidgetsPod (1.0.0):
    - GaugeCore (~> 2.0)

DEPENDENCIES:
  - WidgetsPod

COCOAPODS: 1.16.2
`,
    );
    return dir;
  }

  it("names the SDK and each pod, with what the pod depends on", () => {
    const dir = pods();
    const opts = { cacheDir: tmp("lucent-cache-"), ios: podsSearchPaths(dir)! };

    const artifacts = nativeArtifacts("ios", opts);
    if ("missing" in artifacts) throw new Error(artifacts.missing);

    const sdk = artifacts.find((a) => a.kind === "sdk");
    expect(sdk).toMatchObject({
      id: expect.stringMatching(/^sdk:iphonesimulator\d+\.\d+$/),
      target: "ios",
      targetTriple: "arm64-apple-ios15.1-simulator",
      contentHash: expect.stringMatching(HEX),
    });
    expect(sdk?.modules).toContain("UIKit");

    const header = path.join(dir, "Pods/Headers/Public/WidgetsPod/WPGauge.h");
    expect(artifacts.find((a) => a.id.startsWith("pod:"))).toEqual({
      id: "pod:WidgetsPod@1.0.0",
      target: "ios",
      kind: "clang-module",
      contentHash: expect.stringMatching(HEX),
      targetTriple: "arm64-apple-ios15.1-simulator",
      dependencies: ["pod:GaugeCore@2.1.0"],
      modules: ["WidgetsPod"],
      declarationInputs: expect.arrayContaining([header]),
      includePaths: opts.ios.includePaths,
      compilerArguments: ["-DCOCOAPODS=1"],
      origin: {
        package: "WidgetsPod",
        version: "1.0.0",
        buildFile: path.join(dir, "Podfile.lock"),
      },
    });
  });

  it("reads declarations with the compiler flags the pods build with", () => {
    const dir = pods();
    const header = path.join(dir, "Pods/Headers/Public/WidgetsPod/WPGauge.h");
    const text = fs.readFileSync(header, "utf8");
    fs.writeFileSync(
      header,
      text.replace("@end", "#if COCOAPODS\n- (void)installedWithPods;\n#endif\n@end"),
    );
    forgetLoadedSdks();

    const r = sdkModule("ios", "WidgetsPod", {
      cacheDir: tmp("lucent-cache-"),
      ios: podsSearchPaths(dir)!,
    });
    const gauge = "schema" in r ? r.schema.types.find((t) => t.name === "WPGauge") : undefined;

    expect(gauge?.kind === "class" && gauge.methods?.map((m) => m.name)).toContain(
      "installedWithPods",
    );
  });

  it("names the artifacts a module's schema was read from", () => {
    const opts = { cacheDir: tmp("lucent-cache-"), ios: podsSearchPaths(pods())! };

    sdkModule("ios", "WidgetsPod", opts);
    const read = sdkModuleArtifacts("ios", "WidgetsPod", opts).map((a) => a.id);

    // The pod, and the SDK whose Foundation types its signatures use.
    expect(read).toEqual(["pod:WidgetsPod@1.0.0", expect.stringMatching(/^sdk:iphonesimulator/)]);
  });
});

describe.skipIf(!xcode)("native artifacts: pods built as frameworks (use_frameworks!)", () => {
  /** An app whose pods are frameworks: nothing in Pods/Headers, module maps in Target Support Files. */
  function app() {
    const dir = tmp("lucent-frameworks-");
    fs.cpSync(path.join(fixtures, "pods-frameworks"), dir, { recursive: true });

    // A dependency of the library with a header of the same name (not ignored by git here).
    const decoy = path.join(dir, "gauge-kit/node_modules/dial/ios/GKDial.h");
    fs.mkdirSync(path.dirname(decoy), { recursive: true });
    fs.writeFileSync(decoy, '#error "not the pod\'s header"\n');

    return dir;
  }

  it("finds each framework's module map and public headers before Xcode builds it", () => {
    const dir = app();
    const support = path.join(dir, "ios/Pods/Target Support Files/gauge-kit");

    const pods = podsSearchPaths(path.join(dir, "ios"))!;

    expect(pods.frameworks).toEqual([
      {
        module: "GaugeKit",
        moduleMap: path.join(support, "gauge-kit.modulemap"),
        umbrella: path.join(support, "gauge-kit-umbrella.h"),
        headers: [
          path.join(dir, "gauge-kit/ios/GKDial.h"),
          path.join(dir, "gauge-kit/ios/GKGauge.h"),
        ],
      },
    ]);
  });

  it("binds a pod's framework module, imported as the framework and linked by the pod", () => {
    const dir = app();
    const opts = { cacheDir: tmp("lucent-cache-"), ios: podsSearchPaths(path.join(dir, "ios"))! };

    const r = sdkModule("ios", "GaugeKit", opts);
    if ("missing" in r) throw new Error(r.missing);

    expect(r.schema.types.map((t) => t.name).sort()).toEqual(["GKDial", "GKDialStyle", "GKGauge"]);
    expect(r.schema.types.find((t) => t.name === "GKDialStyle")).toMatchObject({
      cases: [
        { name: "arc", value: 0 },
        { name: "ring", value: 3 },
      ],
    });
    expect({ header: r.schema.header, frameworks: r.schema.frameworks }).toEqual({
      header: "GaugeKit/gauge-kit-umbrella.h",
      frameworks: [],
    });
    // The pod Podfile.lock installed, though its module has another name.
    expect(r.schema.provenance).toMatchObject({
      artifact: "pod:gauge-kit@2.0.0",
      kind: "framework",
    });

    const artifacts = nativeArtifacts("ios", opts);
    expect(
      "missing" in artifacts ? artifacts : artifacts.find((a) => a.id.startsWith("pod:")),
    ).toMatchObject({
      id: "pod:gauge-kit@2.0.0",
      modules: ["GaugeKit"],
      origin: { package: "gauge-kit", version: "2.0.0" },
    });
  });
});
