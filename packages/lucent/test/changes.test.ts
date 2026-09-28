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
