import { describe, expect, it } from "vite-plus/test";
import type { ResolvedNative } from "@lucent-lang/compiler";
import { classifyChanges, type NativeChange } from "../src/cli/changes.ts";

const hash = "0000000000000000";

/** What an app with one package listing each kind of native file resolves to. */
function manifest(over: Partial<ResolvedNative["ios"]> = {}): ResolvedNative {
  const at = (p: string) => ({ package: "lucent-orbit", path: p, hash });

  return {
    packages: { "lucent-orbit": "1.0.0" },
    ios: {
      pods: {},
      frameworks: {},
      infoPlist: {},
      nativeSources: [at("native/ios")],
      resources: [at("assets/chime.caf")],
      resourceBundles: { OrbitAssets: [at("assets/images")] },
      vendoredFrameworks: [at("vendor/Orbit.xcframework")],
      swiftPackages: {},
      entitlements: {},
      ...over,
    },
    android: {
      dependencies: {},
      permissions: {},
      nativeSources: [at("native/android")],
      resources: [at("res")],
      assets: [at("assets/android")],
      libraries: [at("libs/orbit.aar")],
      nativeLibraries: [at("jniLibs")],
      components: {},
    },
    extensions: {},
  };
}

function classify(change: Partial<NativeChange>) {
  return classifyChanges({
    written: [],
    added: [],
    removed: [],
    manifest: manifest(),
    previous: manifest(),
    targets: ["ios", "android"],
    ...change,
  });
}

describe("classifying a build's changes into the actions the app needs", () => {
  it("asks for nothing when no output changed (a JavaScript-only edit is Metro's)", () => {
    expect(classify({})).toEqual([]);
  });

  it("recompiles native code, on the platforms whose code changed, for a Lucent body edit", () => {
    expect(classify({ written: ["cpp/generated/ios/m_a.cpp"] })).toEqual([
      { kind: "compile-native", targets: ["ios"], files: ["cpp/generated/ios/m_a.cpp"] },
    ]);
    expect(classify({ written: ["cpp/generated/m_a.cpp", "cpp/generated/m_a.h"] })).toEqual([
      {
        kind: "compile-native",
        targets: ["ios", "android"],
        files: ["cpp/generated/m_a.cpp", "cpp/generated/m_a.h"],
      },
    ]);
  });

  it("reloads JavaScript too when a signature edit changes the proxies", () => {
    expect(classify({ written: ["cpp/generated/m_a.cpp", "js/a.js"] })).toEqual([
      { kind: "compile-native", targets: ["ios", "android"], files: ["cpp/generated/m_a.cpp"] },
      { kind: "reload-js", targets: ["ios", "android"], files: ["js/a.js"] },
    ]);
  });

  it("classifies a package's file by the field that lists it, not by its extension", () => {
    const pkg = "packages/lucent-orbit";

    expect(classify({ written: [`${pkg}/assets/chime.caf`] })).toEqual([
      { kind: "repackage", targets: ["ios"], files: [`${pkg}/assets/chime.caf`] },
    ]);
    expect(
      classify({ written: [`${pkg}/assets/images/logo.png`, `${pkg}/res/drawable/pin.png`] }),
    ).toEqual([
      {
        kind: "repackage",
        targets: ["ios", "android"],
        files: [`${pkg}/assets/images/logo.png`, `${pkg}/res/drawable/pin.png`],
      },
    ]);
    expect(classify({ written: [`${pkg}/native/android/orbit.cpp`] })).toEqual([
      { kind: "compile-native", targets: ["android"], files: [`${pkg}/native/android/orbit.cpp`] },
    ]);
    expect(
      classify({
        written: [`${pkg}/libs/orbit.aar`, `${pkg}/vendor/Orbit.xcframework/Info.plist`],
      }),
    ).toEqual([
      {
        kind: "relink",
        targets: ["ios", "android"],
        files: [`${pkg}/libs/orbit.aar`, `${pkg}/vendor/Orbit.xcframework/Info.plist`],
      },
    ]);
  });

  it("relinks for build files, and reinstalls for the app's configuration", () => {
    expect(classify({ written: ["LucentNative.podspec", "android/build.gradle"] })).toEqual([
      {
        kind: "relink",
        targets: ["ios", "android"],
        files: ["LucentNative.podspec", "android/build.gradle"],
      },
    ]);
    expect(classify({ written: ["android/src/main/AndroidManifest.xml"] })).toEqual([
      { kind: "reinstall", targets: ["android"], files: ["android/src/main/AndroidManifest.xml"] },
    ]);

    const plist = manifest({
      infoPlist: { NSCameraUsageDescription: { value: "Scan", from: ["lucent-orbit"] } },
    });
    expect(classify({ written: ["resolved.json"], manifest: plist })).toEqual([
      { kind: "reinstall", targets: ["ios"], files: ["resolved.json#ios.infoPlist"] },
    ]);
    // The rest of resolved.json is reflected in the build files.
    expect(classify({ written: ["resolved.json", "manifest.json"] })).toEqual([]);
  });

  it("relinks iOS when files come or go, since CocoaPods lists them at pod install", () => {
    expect(
      classify({ written: ["cpp/generated/m_b.cpp"], added: ["cpp/generated/m_b.cpp"] }),
    ).toEqual([
      { kind: "relink", targets: ["ios"], files: ["cpp/generated/m_b.cpp"] },
      { kind: "compile-native", targets: ["ios", "android"], files: ["cpp/generated/m_b.cpp"] },
    ]);

    const pkg = "packages/lucent-orbit";
    expect(
      classify({ removed: [`${pkg}/assets/chime.caf`], manifest: manifest({ resources: [] }) }),
    ).toEqual([
      { kind: "relink", targets: ["ios"], files: [`${pkg}/assets/chime.caf`] },
      { kind: "repackage", targets: ["ios"], files: [`${pkg}/assets/chime.caf`] },
    ]);
  });

  it("names only the platforms the build targets", () => {
    expect(
      classify({ written: ["cpp/generated/m_a.cpp", "LucentNative.podspec"], targets: ["host"] }),
    ).toEqual([{ kind: "compile-native", targets: ["host"], files: ["cpp/generated/m_a.cpp"] }]);
  });

  it("relinks, to be safe, for an output it does not know", () => {
    expect(classify({ written: ["something/new.txt"] })).toEqual([
      { kind: "relink", targets: ["ios", "android"], files: ["something/new.txt"] },
    ]);
  });
});

describe("a package's native dependencies, which a build writes into the build files before it checks", () => {
  const from = ["lucent-orbit"];
  const asked = (needs: Record<string, string>) =>
    Object.fromEntries(Object.entries(needs).map(([name, r]) => [name, { [r]: from }]));

  const withPods = (pods: Record<string, string>) => manifest({ pods: asked(pods) });
  const withGradle = (dependencies: Record<string, string>, minSdk?: number): ResolvedNative => {
    const m = manifest();

    return {
      ...m,
      android: {
        ...m.android,
        dependencies: asked(dependencies),
        ...(minSdk ? { minSdk: { value: minSdk, from } } : {}),
      },
    };
  };

  const twoPods = withPods({ OrbitKit: "~> 1.0", OrbitUI: "~> 2.0" });

  it.each([
    ["a pod's requirement changes", { OrbitKit: "~> 1.1", OrbitUI: "~> 2.0" }],
    ["a pod is added", { OrbitKit: "~> 1.0", OrbitUI: "~> 2.0", OrbitMaps: "3.0" }],
    ["one of two pods is dropped", { OrbitKit: "~> 1.0" }],
  ])("relinks iOS when %s, though the podspec had it before the build", (_, pods) => {
    expect(
      classify({ written: ["resolved.json"], manifest: withPods(pods), previous: twoPods }),
    ).toEqual([{ kind: "relink", targets: ["ios"], files: ["resolved.json#ios.pods"] }]);
  });

  it.each([
    [
      "a Gradle artifact's version changes",
      withGradle({ "dev.orbit:orbit": "1.1.0" }),
      "dependencies",
    ],
    ["the minimum SDK rises", withGradle({ "dev.orbit:orbit": "1.0.0" }, 26), "minSdk"],
  ])("relinks Android when %s, though build.gradle had it before the build", (_, after, field) => {
    expect(
      classify({
        written: ["resolved.json"],
        manifest: after,
        previous: withGradle({ "dev.orbit:orbit": "1.0.0" }),
      }),
    ).toEqual([
      { kind: "relink", targets: ["android"], files: [`resolved.json#android.${field}`] },
    ]);
  });

  it("asks for nothing when only who asks for a pod changes: the podspec says the same", () => {
    const shared = manifest({
      pods: {
        OrbitKit: { "~> 1.0": ["lucent-moon", "lucent-orbit"] },
        OrbitUI: { "~> 2.0": from },
      },
    });

    expect(classify({ written: ["resolved.json"], manifest: shared, previous: twoPods })).toEqual(
      [],
    );
  });

  it("relinks iOS on the first build for the packages' pods, and for nothing without them", () => {
    expect(
      classify({ written: ["resolved.json"], manifest: twoPods, previous: undefined }),
    ).toEqual([{ kind: "relink", targets: ["ios"], files: ["resolved.json#ios.pods"] }]);
    expect(classify({ written: ["resolved.json"], previous: undefined })).toEqual([]);
  });
});
