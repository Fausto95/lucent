import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vite-plus/test";
import { fileHashes, type LucentPackage, resolveNative } from "../src/index.ts";

/** A Lucent package on disk whose lucent.json is `native` (none when undefined). */
function pkg(name: string, native?: unknown, version = "1.0.0"): LucentPackage {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lucent-config-"));

  if (native !== undefined) fs.writeFileSync(path.join(dir, "lucent.json"), JSON.stringify(native));

  return { name, version, dir, sources: path.join(dir, "src") };
}

describe("lucent.json", () => {
  it("rejects a field the build does not read, naming the package and the field", () => {
    expect(() => resolveNative([pkg("lucent-a", { ios: { podz: { Kit: "1.0" } } })])).toThrow(
      "lucent-a/lucent.json: unknown field ios.podz",
    );
    expect(() => resolveNative([pkg("lucent-a", { web: {} })])).toThrow(
      "lucent-a/lucent.json: unknown field web",
    );
  });

  it("rejects a value of the wrong type, naming where it is", () => {
    expect(() => resolveNative([pkg("lucent-a", { ios: { pods: { Kit: 1 } } })])).toThrow(
      "lucent-a/lucent.json: ios.pods.Kit must be a string",
    );
    expect(() =>
      resolveNative([pkg("lucent-a", { android: { permissions: "android.permission.CAMERA" } })]),
    ).toThrow("lucent-a/lucent.json: android.permissions must be an array of strings");
    expect(() =>
      resolveNative([pkg("lucent-a", { ios: { infoPlist: { UIBackgroundModes: [1] } } })]),
    ).toThrow(
      "lucent-a/lucent.json: ios.infoPlist.UIBackgroundModes must be a string, a boolean or an array of strings",
    );
  });

  it("reports a lucent.json that is not JSON", () => {
    const p = pkg("lucent-a");
    fs.writeFileSync(path.join(p.dir, "lucent.json"), "{ ios: }");

    expect(() => resolveNative([p])).toThrow(/^lucent-a\/lucent\.json: /);
  });

  it("records every package, with its version, whether or not it has a lucent.json", () => {
    const { manifest } = resolveNative([pkg("lucent-b", undefined, "2.0.0"), pkg("lucent-a", {})]);

    expect(manifest.packages).toEqual({ "lucent-a": "1.0.0", "lucent-b": "2.0.0" });
  });
});

describe("merging packages' native needs", () => {
  it("deduplicates set-like needs, naming every package that asked", () => {
    const { manifest } = resolveNative([
      pkg("lucent-b", {
        ios: { frameworks: ["CoreHaptics", "AVFoundation"] },
        android: { permissions: ["android.permission.VIBRATE"] },
      }),
      pkg("lucent-a", {
        ios: { frameworks: ["CoreHaptics"] },
        android: { permissions: ["android.permission.VIBRATE", "android.permission.CAMERA"] },
      }),
    ]);

    expect(manifest.ios.frameworks).toEqual({
      AVFoundation: ["lucent-b"],
      CoreHaptics: ["lucent-a", "lucent-b"],
    });
    expect(manifest.android.permissions).toEqual({
      "android.permission.CAMERA": ["lucent-a"],
      "android.permission.VIBRATE": ["lucent-a", "lucent-b"],
    });
  });

  it("gives CocoaPods every requirement of a pod, and fails for ones no version meets", () => {
    const { manifest } = resolveNative([
      pkg("lucent-a", { ios: { pods: { Kit: "~> 1.0" } } }),
      pkg("lucent-b", { ios: { pods: { Kit: ">= 1.2" } } }),
      pkg("lucent-c", { ios: { pods: { Kit: "~> 1.0", Other: "2.0" } } }),
    ]);

    expect(manifest.ios.pods).toEqual({
      Kit: { "~> 1.0": ["lucent-a", "lucent-c"], ">= 1.2": ["lucent-b"] },
      Other: { "2.0": ["lucent-c"] },
    });

    expect(() =>
      resolveNative([
        pkg("lucent-a", { ios: { pods: { Kit: "~> 1.0" } } }),
        pkg("lucent-b", { ios: { pods: { Kit: "~> 2.0" } } }),
      ]),
    ).toThrow("pod Kit: lucent-a wants ~> 1.0, lucent-b wants ~> 2.0");
    expect(() =>
      resolveNative([
        pkg("lucent-a", { ios: { pods: { Kit: ">= 1.0, < 1.4" } } }),
        pkg("lucent-b", { ios: { pods: { Kit: "~> 1.4.2" } } }),
      ]),
    ).toThrow("pod Kit: lucent-a wants >= 1.0, < 1.4, lucent-b wants ~> 1.4.2");
  });

  it("gives Gradle every version of an artifact, and fails when a strict one excludes another", () => {
    const { manifest } = resolveNative([
      pkg("lucent-a", { android: { dependencies: { "androidx.core:core": "1.12.0" } } }),
      pkg("lucent-b", { android: { dependencies: { "androidx.core:core": "1.13.1" } } }),
    ]);

    expect(manifest.android.dependencies).toEqual({
      "androidx.core:core": { "1.12.0": ["lucent-a"], "1.13.1": ["lucent-b"] },
    });

    expect(() =>
      resolveNative([
        pkg("lucent-a", { android: { dependencies: { "g:a": "1.0!!" } } }),
        pkg("lucent-b", { android: { dependencies: { "g:a": "2.0" } } }),
      ]),
    ).toThrow("Gradle g:a: lucent-a wants 1.0!!, lucent-b wants 2.0");
  });

  it("requires one value per Info.plist key, and joins array values", () => {
    const { manifest } = resolveNative([
      pkg("lucent-a", {
        ios: {
          infoPlist: {
            NSFaceIDUsageDescription: "Unlock with Face ID",
            UIBackgroundModes: ["location", "audio"],
            UIFileSharingEnabled: true,
          },
        },
      }),
      pkg("lucent-b", {
        ios: {
          infoPlist: {
            NSFaceIDUsageDescription: "Unlock with Face ID",
            UIBackgroundModes: ["fetch", "audio"],
          },
        },
      }),
    ]);

    expect(manifest.ios.infoPlist).toEqual({
      NSFaceIDUsageDescription: { value: "Unlock with Face ID", from: ["lucent-a", "lucent-b"] },
      UIBackgroundModes: { value: ["audio", "fetch", "location"], from: ["lucent-a", "lucent-b"] },
      UIFileSharingEnabled: { value: true, from: ["lucent-a"] },
    });

    expect(() =>
      resolveNative([
        pkg("lucent-a", { ios: { infoPlist: { NSCameraUsageDescription: "Scan" } } }),
        pkg("lucent-b", { ios: { infoPlist: { NSCameraUsageDescription: "Photos" } } }),
      ]),
    ).toThrow(
      'Info.plist NSCameraUsageDescription: lucent-a wants "Scan", lucent-b wants "Photos"',
    );
    expect(() =>
      resolveNative([
        pkg("lucent-a", { ios: { infoPlist: { UIBackgroundModes: ["audio"] } } }),
        pkg("lucent-b", { ios: { infoPlist: { UIBackgroundModes: "audio" } } }),
      ]),
    ).toThrow('Info.plist UIBackgroundModes: lucent-a wants ["audio"], lucent-b wants "audio"');
  });

  it("merges the same way whatever order the packages come in", () => {
    const packages = [
      pkg("lucent-a", {
        ios: { pods: { Kit: "~> 1.0" }, frameworks: ["CoreHaptics"] },
        android: { dependencies: { "g:a": "1.0" }, permissions: ["android.permission.VIBRATE"] },
      }),
      pkg("lucent-b", {
        ios: { pods: { Kit: ">= 1.1" }, infoPlist: { UIBackgroundModes: ["audio"] } },
        android: { dependencies: { "g:a": "1.1" }, permissions: ["android.permission.CAMERA"] },
      }),
    ];

    const forward = resolveNative(packages).manifest;
    const backward = resolveNative(packages.toReversed()).manifest;

    expect(JSON.stringify(backward)).toBe(JSON.stringify(forward));
  });
});

/** Writes `files` (package-relative path → content) into the package. */
function withFiles(p: LucentPackage, files: Record<string, string>): LucentPackage {
  for (const [rel, content] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(p.dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(p.dir, rel), content);
  }

  return p;
}

describe("packages' native files", () => {
  it("resolves them in the package that lists them, and records where they come from", () => {
    const p = withFiles(
      pkg("lucent-orbit", {
        ios: { nativeSources: ["native/ios"], resources: ["assets/beep.caf"] },
        android: { nativeSources: ["native/android"], assets: ["assets/android"] },
      }),
      {
        "native/ios/orbit.mm": "// ios\n",
        "native/ios/.DS_Store": "noise",
        "native/android/dev/orbit/Orbit.java": "package dev.orbit;\n",
        "assets/beep.caf": "caf",
        "assets/android/sounds/beep.ogg": "ogg",
      },
    );

    const { manifest, files } = resolveNative([p]);

    expect(manifest.ios.nativeSources).toEqual([
      {
        package: "lucent-orbit",
        path: "native/ios",
        hash: expect.stringMatching(/^[0-9a-f]{16}$/),
      },
    ]);
    expect(manifest.ios.resources.map((r) => r.path)).toEqual(["assets/beep.caf"]);
    expect(manifest.android.assets.map((r) => r.path)).toEqual(["assets/android"]);

    // Copied into the native package under the package's name; hidden files stay behind.
    expect(Object.fromEntries(files)).toEqual({
      "packages/lucent-orbit/native/ios/orbit.mm": path.join(p.dir, "native/ios/orbit.mm"),
      "packages/lucent-orbit/native/android/dev/orbit/Orbit.java": path.join(
        p.dir,
        "native/android/dev/orbit/Orbit.java",
      ),
      "packages/lucent-orbit/assets/beep.caf": path.join(p.dir, "assets/beep.caf"),
      "packages/lucent-orbit/assets/android/sounds/beep.ogg": path.join(
        p.dir,
        "assets/android/sounds/beep.ogg",
      ),
    });
  });

  it("says where the prebuilt frameworks and libraries are, for bindings to read", () => {
    const orbit = withFiles(
      pkg("lucent-orbit", {
        ios: { vendoredFrameworks: ["vendor/Orbit.xcframework"] },
        android: { libraries: ["libs/orbit.aar"] },
      }),
      { "vendor/Orbit.xcframework/Info.plist": "<plist/>", "libs/orbit.aar": "aar" },
    );
    const gauge = withFiles(pkg("lucent-gauge", { android: { libraries: ["gauge.jar"] } }), {
      "gauge.jar": "jar",
    });

    const { binaries } = resolveNative([orbit, gauge]);

    expect(binaries).toEqual({
      ios: [path.join(orbit.dir, "vendor/Orbit.xcframework")],
      android: [path.join(gauge.dir, "gauge.jar"), path.join(orbit.dir, "libs/orbit.aar")],
    });
  });

  it("changes an input's hash with its content, and only then", () => {
    const p = withFiles(pkg("lucent-orbit", { ios: { nativeSources: ["native"] } }), {
      "native/a.c": "int a;\n",
    });
    const hash = () => resolveNative([p]).manifest.ios.nativeSources[0]!.hash;

    const before = hash();
    expect(hash()).toBe(before);

    fs.writeFileSync(path.join(p.dir, "native/a.c"), "int b;\n");
    expect(hash()).not.toBe(before);
  });

  it("rejects a path outside the package, missing, or of the wrong kind, naming the field", () => {
    const at =
      (native: unknown, files: Record<string, string> = {}) =>
      () =>
        resolveNative([withFiles(pkg("lucent-orbit", native), files)]);

    expect(at({ ios: { nativeSources: ["../elsewhere"] } })).toThrow(
      'lucent-orbit/lucent.json: ios.nativeSources "../elsewhere" is outside the package',
    );
    expect(at({ ios: { nativeSources: ["/usr/include"] } })).toThrow(
      'lucent-orbit/lucent.json: ios.nativeSources "/usr/include" is outside the package',
    );
    expect(at({ android: { assets: ["assets"] } })).toThrow(
      'lucent-orbit/lucent.json: android.assets "assets" does not exist',
    );
    expect(at({ android: { resources: ["res"] } }, { res: "a file" })).toThrow(
      'lucent-orbit/lucent.json: android.resources "res" is not a directory',
    );
    expect(at({ android: { libraries: ["libs/orbit.zip"] } }, { "libs/orbit.zip": "zip" })).toThrow(
      'lucent-orbit/lucent.json: android.libraries "libs/orbit.zip" is not an .aar or .jar file',
    );
    expect(
      at({ ios: { vendoredFrameworks: ["Orbit"] } }, { "Orbit/Info.plist": "<plist/>" }),
    ).toThrow(
      'lucent-orbit/lucent.json: ios.vendoredFrameworks "Orbit" is not a .framework or .xcframework directory',
    );
  });

  it("fails when two files would land in the same place, naming both", () => {
    const two = (a: object, b: object, files: Record<string, string>) => () =>
      resolveNative([withFiles(pkg("lucent-a", a), files), withFiles(pkg("lucent-b", b), files)]);

    expect(
      two(
        { ios: { resources: ["assets/beep.caf"] } },
        { ios: { resources: ["assets/beep.caf"] } },
        { "assets/beep.caf": "caf" },
      ),
    ).toThrow(
      "iOS resource beep.caf: lucent-a has assets/beep.caf, lucent-b has assets/beep.caf (both land at the app bundle's root: namespace one with ios.resourceBundles)",
    );
    expect(
      two(
        { ios: { resourceBundles: { Orbit: ["assets"] } } },
        { ios: { resourceBundles: { Orbit: ["assets"] } } },
        { "assets/beep.caf": "caf" },
      ),
    ).toThrow("iOS resource bundle Orbit: lucent-a has assets, lucent-b has assets");
    expect(
      two(
        { ios: { vendoredFrameworks: ["Orbit.xcframework"] } },
        { ios: { vendoredFrameworks: ["Orbit.xcframework"] } },
        { "Orbit.xcframework/Info.plist": "<plist/>" },
      ),
    ).toThrow(
      "iOS framework Orbit: lucent-a has Orbit.xcframework, lucent-b has Orbit.xcframework",
    );
    expect(
      two(
        { android: { resources: ["res"] } },
        { android: { resources: ["res"] } },
        { "res/drawable/icon.png": "png" },
      ),
    ).toThrow(
      "Android resource drawable/icon.png: lucent-a has res/drawable/icon.png, lucent-b has res/drawable/icon.png",
    );
    expect(
      two(
        { android: { assets: ["assets"] } },
        { android: { assets: ["assets"] } },
        { "assets/sounds/beep.ogg": "ogg" },
      ),
    ).toThrow(
      "Android asset sounds/beep.ogg: lucent-a has assets/sounds/beep.ogg, lucent-b has assets/sounds/beep.ogg",
    );
    expect(
      two(
        { android: { libraries: ["libs/orbit.aar"] } },
        { android: { libraries: ["libs/orbit.aar"] } },
        { "libs/orbit.aar": "aar" },
      ),
    ).toThrow(
      "Android library orbit.aar: lucent-a has libs/orbit.aar, lucent-b has libs/orbit.aar",
    );
    expect(
      two(
        { android: { nativeLibraries: ["jni"] } },
        { android: { nativeLibraries: ["jni"] } },
        { "jni/arm64-v8a/liborbit.so": "so" },
      ),
    ).toThrow(
      "Android native library arm64-v8a/liborbit.so: lucent-a has jni/arm64-v8a/liborbit.so, lucent-b has jni/arm64-v8a/liborbit.so",
    );
    expect(
      two(
        { android: { nativeSources: ["java"] } },
        { android: { nativeSources: ["java"] } },
        { "java/dev/orbit/Orbit.java": "package dev.orbit;" },
      ),
    ).toThrow(
      "Android source dev/orbit/Orbit.java: lucent-a has java/dev/orbit/Orbit.java, lucent-b has java/dev/orbit/Orbit.java",
    );
  });

  it("lets Android merge value resources, which it does by name", () => {
    const files = { "res/values/strings.xml": "<resources/>" };

    const { manifest } = resolveNative([
      withFiles(pkg("lucent-a", { android: { resources: ["res"] } }), files),
      withFiles(pkg("lucent-b", { android: { resources: ["res"] } }), files),
    ]);

    expect(manifest.android.resources.map((r) => `${r.package}:${r.path}`)).toEqual([
      "lucent-a:res",
      "lucent-b:res",
    ]);
  });
});

describe("entitlements, Swift packages, manifest components and target requirements", () => {
  it("merges entitlements like Info.plist entries, naming both packages of a conflict", () => {
    const { manifest } = resolveNative([
      pkg("lucent-a", {
        ios: {
          entitlements: {
            "com.apple.developer.healthkit": true,
            "com.apple.security.application-groups": ["group.dev.orbit"],
          },
        },
      }),
      pkg("lucent-b", {
        ios: {
          entitlements: {
            "com.apple.developer.healthkit": true,
            "com.apple.security.application-groups": ["group.dev.maps"],
          },
        },
      }),
    ]);

    expect(manifest.ios.entitlements).toEqual({
      "com.apple.developer.healthkit": { value: true, from: ["lucent-a", "lucent-b"] },
      "com.apple.security.application-groups": {
        value: ["group.dev.maps", "group.dev.orbit"],
        from: ["lucent-a", "lucent-b"],
      },
    });

    expect(() =>
      resolveNative([
        pkg("lucent-a", { ios: { entitlements: { "aps-environment": "development" } } }),
        pkg("lucent-b", { ios: { entitlements: { "aps-environment": "production" } } }),
      ]),
    ).toThrow(
      'entitlement aps-environment: lucent-a wants "development", lucent-b wants "production"',
    );
  });

  it("gives a Swift package one requirement, and joins the products packages use", () => {
    const url = "https://github.com/orbit/orbit-swift";
    const requirement = { kind: "upToNextMajorVersion", minimumVersion: "1.2.0" };

    const { manifest } = resolveNative([
      pkg("lucent-a", { ios: { swiftPackages: { [url]: { requirement, products: ["Orbit"] } } } }),
      pkg("lucent-b", {
        ios: { swiftPackages: { [url]: { requirement, products: ["OrbitMaps", "Orbit"] } } },
      }),
    ]);

    expect(manifest.ios.swiftPackages).toEqual({
      [url]: { requirement, products: ["Orbit", "OrbitMaps"], from: ["lucent-a", "lucent-b"] },
    });

    expect(() =>
      resolveNative([
        pkg("lucent-a", {
          ios: { swiftPackages: { [url]: { requirement, products: ["Orbit"] } } },
        }),
        pkg("lucent-b", {
          ios: {
            swiftPackages: {
              [url]: {
                requirement: { kind: "exactVersion", version: "2.0.0" },
                products: ["Orbit"],
              },
            },
          },
        }),
      ]),
    ).toThrow(
      `Swift package ${url}: lucent-a wants upToNextMajorVersion 1.2.0, lucent-b wants exactVersion 2.0.0`,
    );

    expect(() =>
      resolveNative([
        pkg("lucent-a", {
          ios: {
            swiftPackages: { [url]: { requirement: { kind: "from", version: "1" }, products: [] } },
          },
        }),
      ]),
    ).toThrow(
      `lucent-a/lucent.json: ios.swiftPackages.${url}.requirement must be a Swift package requirement`,
    );
  });

  it("requires the highest deployment target and minimum SDK any package needs", () => {
    const { manifest } = resolveNative([
      pkg("lucent-a", { ios: { deploymentTarget: "15.1" }, android: { minSdk: 26 } }),
      pkg("lucent-b", { ios: { deploymentTarget: "16.0" }, android: { minSdk: 24 } }),
      pkg("lucent-c", { ios: { deploymentTarget: "16" } }),
    ]);

    expect(manifest.ios.deploymentTarget).toEqual({
      value: "16.0",
      from: ["lucent-b", "lucent-c"],
    });
    expect(manifest.android.minSdk).toEqual({ value: 26, from: ["lucent-a"] });

    expect(() => resolveNative([pkg("lucent-a", { ios: { deploymentTarget: "iOS 15" } })])).toThrow(
      'lucent-a/lucent.json: ios.deploymentTarget must be a version such as "15.1"',
    );
    expect(() => resolveNative([pkg("lucent-a", { android: { minSdk: 23.5 } })])).toThrow(
      "lucent-a/lucent.json: android.minSdk must be a positive integer",
    );
  });

  it("declares a manifest component once, and fails when packages declare it differently", () => {
    const sync = {
      kind: "service",
      name: "dev.orbit.SyncService",
      exported: false,
      foregroundServiceType: "dataSync",
    };

    const { manifest } = resolveNative([
      pkg("lucent-a", { android: { components: [sync] } }),
      pkg("lucent-b", { android: { components: [sync] } }),
    ]);

    expect(manifest.android.components).toEqual({
      "dev.orbit.SyncService": { value: sync, from: ["lucent-a", "lucent-b"] },
    });

    expect(() =>
      resolveNative([
        pkg("lucent-a", { android: { components: [sync] } }),
        pkg("lucent-b", { android: { components: [{ ...sync, exported: true }] } }),
      ]),
    ).toThrow(
      "Android component dev.orbit.SyncService: lucent-a and lucent-b declare it differently",
    );
  });

  it("checks a manifest component's fields", () => {
    const at = (component: object) => () =>
      resolveNative([pkg("lucent-a", { android: { components: [component] } })]);

    expect(at({ kind: "service", name: ".SyncService" })).toThrow(
      "lucent-a/lucent.json: android.components.0.name must be a fully qualified class name",
    );
    expect(at({ kind: "provider", name: "dev.orbit.Files" })).toThrow(
      "lucent-a/lucent.json: android.components.0.authorities is required for a provider",
    );
    expect(at({ kind: "widget", name: "dev.orbit.Widget" })).toThrow(
      "lucent-a/lucent.json: android.components.0.kind must be one of activity, service, receiver, provider",
    );
    expect(at({ kind: "service", name: "dev.orbit.Sync", process: ":sync" })).toThrow(
      "lucent-a/lucent.json: unknown field android.components.0.process",
    );
  });
});

describe("hashing packages' files", () => {
  it("reuses a file's hash while its size and times say it did not change", () => {
    const p = withFiles(
      pkg("lucent-orbit", { ios: { vendoredFrameworks: ["Orbit.xcframework"] } }),
      {
        "Orbit.xcframework/Info.plist": "<plist/>",
        "Orbit.xcframework/ios-arm64/Orbit.framework/Orbit": "binary",
      },
    );
    const old = new Date(Date.now() - 60_000);
    for (const f of [
      "Orbit.xcframework/Info.plist",
      "Orbit.xcframework/ios-arm64/Orbit.framework/Orbit",
    ])
      fs.utimesSync(path.join(p.dir, f), old, old);

    const store = path.join(
      fs.mkdtempSync(path.join(os.tmpdir(), "lucent-hashes-")),
      "hashes.json",
    );
    const first = fileHashes(store);
    const hash = resolveNative([p], { hashes: first }).manifest.ios.vendoredFrameworks[0]!.hash;
    first.save();
    expect(first.stats()).toEqual({ hits: 0, hashed: 2 });

    // A later build reads the saved hashes.
    const second = fileHashes(store);
    expect(resolveNative([p], { hashes: second }).manifest.ios.vendoredFrameworks[0]!.hash).toBe(
      hash,
    );
    expect(second.stats()).toEqual({ hits: 2, hashed: 0 });

    // A changed file is hashed again.
    fs.writeFileSync(
      path.join(p.dir, "Orbit.xcframework/ios-arm64/Orbit.framework/Orbit"),
      "binary 2",
    );
    const third = fileHashes(store);
    expect(resolveNative([p], { hashes: third }).manifest.ios.vendoredFrameworks[0]!.hash).not.toBe(
      hash,
    );
    expect(third.stats()).toEqual({ hits: 1, hashed: 1 });
  });

  it("does not trust the times of a file changed as it was hashed", () => {
    const p = withFiles(pkg("lucent-orbit", { ios: { nativeSources: ["native"] } }), {
      "native/a.c": "int a;\n",
    });
    const store = path.join(
      fs.mkdtempSync(path.join(os.tmpdir(), "lucent-hashes-")),
      "hashes.json",
    );

    const first = fileHashes(store);
    resolveNative([p], { hashes: first });
    first.save();

    // Just written: its times could stay the same through another write.
    const second = fileHashes(store);
    resolveNative([p], { hashes: second });
    expect(second.stats()).toEqual({ hits: 0, hashed: 1 });
  });
});

describe("native extensions", () => {
  const header = { "native/orbit.h": "typedef struct Orbit Orbit;\n" };
  const sources = { ios: { nativeSources: ["native"] }, android: { nativeSources: ["native"] } };

  it("records each extension with its package, its header's hash and its declaration", () => {
    const declaration = {
      header: "native/orbit.h",
      handles: { Orbit: { create: "orbit_create", destroy: "orbit_destroy" } },
    };
    const p = withFiles(
      pkg("lucent-orbit", { ...sources, extensions: { orbit: declaration } }),
      header,
    );

    const { manifest, extensions } = resolveNative([p]);

    expect(manifest.extensions).toEqual({
      orbit: {
        package: "lucent-orbit",
        header: {
          package: "lucent-orbit",
          path: "native/orbit.h",
          hash: expect.stringMatching(/^[0-9a-f]{16}$/),
        },
        declaration,
      },
    });
    // What reading it needs: where the header is, and where what it includes is.
    expect(extensions).toEqual([
      {
        name: "orbit",
        package: "lucent-orbit",
        header: path.join(p.dir, "native/orbit.h"),
        includePaths: [path.join(p.dir, "native")],
        include: "orbit.h",
        declaration,
        // Changes with the header and the files it may include: a watch session reads it again.
        hash: expect.stringMatching(/^[0-9a-f]{16}:[0-9a-f]{16}$/),
      },
    ]);
  });

  it("needs the header in native sources both platforms build", () => {
    const at = (native: object) => () =>
      resolveNative([
        withFiles(
          pkg("lucent-orbit", { ...native, extensions: { orbit: { header: "native/orbit.h" } } }),
          header,
        ),
      ]);

    expect(at({ ios: { nativeSources: ["native"] } })).toThrow(
      'lucent-orbit/lucent.json: extensions.orbit.header "native/orbit.h" must be in a directory both ios.nativeSources and android.nativeSources list, so both platforms build the extension',
    );
    expect(at({ ...sources, extensions: undefined })).not.toThrow();
    expect(() =>
      resolveNative([
        withFiles(
          pkg("lucent-orbit", { ...sources, extensions: { orbit: { header: "native/nope.h" } } }),
          header,
        ),
      ]),
    ).toThrow('lucent-orbit/lucent.json: extensions.orbit.header "native/nope.h" does not exist');
  });

  it("checks the declaration's shape, naming the field", () => {
    const at = (orbit: object) => () =>
      resolveNative([
        withFiles(pkg("lucent-orbit", { ...sources, extensions: { orbit } }), header),
      ]);

    expect(at({})).toThrow("lucent-orbit/lucent.json: extensions.orbit.header is required");
    expect(
      at({ header: "native/orbit.h", handles: { Orbit: { create: "orbit_create" } } }),
    ).toThrow("lucent-orbit/lucent.json: extensions.orbit.handles.Orbit.destroy is required");
    expect(
      at({
        header: "native/orbit.h",
        functions: { orbit_read: { params: { data: { bytes: "peek", length: "n" } } } },
      }),
    ).toThrow(
      "lucent-orbit/lucent.json: extensions.orbit.functions.orbit_read.params.data.bytes must be one of read, write",
    );
    expect(
      at({ header: "native/orbit.h", functions: { orbit_read: { failsWhen: "never" } } }),
    ).toThrow(
      "lucent-orbit/lucent.json: extensions.orbit.functions.orbit_read.failsWhen must be one of null, negative, nonzero, zero, false",
    );
    expect(at({ header: "native/orbit.h", functions: { "orbit-read": {} } })).toThrow(
      'lucent-orbit/lucent.json: extensions.orbit.functions has "orbit-read", which is not a C name',
    );
    expect(() =>
      resolveNative([
        withFiles(
          pkg("lucent-orbit", { ...sources, extensions: { "2d": { header: "native/orbit.h" } } }),
          header,
        ),
      ]),
    ).toThrow(
      'lucent-orbit/lucent.json: extensions has "2d": an extension\'s name is a letter, then letters, digits, _ or -',
    );
  });

  it("fails when two packages declare an extension of the same name, naming both", () => {
    const one = (name: string) =>
      withFiles(
        pkg(name, { ...sources, extensions: { orbit: { header: "native/orbit.h" } } }),
        header,
      );

    expect(() => resolveNative([one("lucent-b"), one("lucent-a")])).toThrow(
      "extension orbit: lucent-a and lucent-b both declare it",
    );
  });
});
