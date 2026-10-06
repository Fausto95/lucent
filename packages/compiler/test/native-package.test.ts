import { spawnSync } from "node:child_process";
import fs from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vite-plus/test";
import {
  compile,
  type LucentPackage,
  resolveNative,
  runtimeDir,
  writeNativePackage,
} from "../src/index.ts";

/**
 * The native inputs of Lucent packages, each `[name, its lucent.json, its
 * files]`, as the build resolves them.
 */
function nativeOf(...packages: [string, unknown, Record<string, string>?][]) {
  const found: LucentPackage[] = packages.map(([name, native, files = {}]) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lucent-pkg-"));
    fs.writeFileSync(path.join(dir, "lucent.json"), JSON.stringify(native));

    for (const [rel, content] of Object.entries(files)) {
      fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
      fs.writeFileSync(path.join(dir, rel), content);
    }

    return { name, version: "1.0.0", dir, sources: path.join(dir, "src") };
  });

  return resolveNative(found);
}

/** A compiled one-function program. */
function program(dir: string) {
  const src = path.join(dir, "a.lucent.ts");
  fs.writeFileSync(src, "export function one(): number { return 1; }\n");

  return compile([src]);
}

const hasRuby = spawnSync("ruby", ["--version"]).status === 0;

function files(dir: string): string[] {
  return fs
    .readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((e) => e.isFile())
    .map((e) => path.relative(dir, path.join(e.parentPath, e.name)));
}

describe("native package", () => {
  it("ships every runtime source file", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lucent-pkg-"));
    const src = path.join(dir, "sample.lucent.ts");
    fs.writeFileSync(src, "export function one(): number { return 1; }");
    const out = path.join(dir, "native");
    writeNativePackage(compile([src]), out);
    for (const sub of ["cpp/lucent", "cpp/rn", "cpp/third_party"]) {
      expect(files(path.join(out, sub)).sort()).toEqual(files(path.join(runtimeDir(), sub)).sort());
    }
  });

  it("writes the lucent:core declarations for the app's tsconfig paths", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lucent-pkg-"));
    const src = path.join(dir, "sample.lucent.ts");
    fs.writeFileSync(src, "export function one(): number { return 1; }");
    const out = path.join(dir, "native");
    writeNativePackage(compile([src]), out);
    expect(fs.readFileSync(path.join(out, "types/core.d.ts"), "utf8")).toContain(
      "export declare function delay(",
    );
  });

  it("ships the JS loader its proxies require, so apps install no Lucent runtime package", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lucent-pkg-"));
    // A module may be named like the loader without clashing with it.
    const src = path.join(dir, "runtime.lucent.ts");
    fs.writeFileSync(
      src,
      "export function one(): number { return 1; }\nexport class Box { constructor(readonly n: number) {} }\n",
    );
    const out = path.join(dir, "native");
    const result = compile([src]);
    writeNativePackage(result, out);
    const proxy = fs.readFileSync(path.join(out, "js/runtime.js"), "utf8");
    expect(proxy).not.toContain("@lucent-lang/runtime");
    expect(proxy).toContain('require("./_lucent/runtime.js")');
    // The proxy runs against the native module through the loader, which checks what it was built from.
    const Box = function Box(n: number) {
      return { n };
    };
    const { runtimeAbi, programs, apis } = result.identity!;
    const __lucentIdentity = {
      host: 1,
      runtimeAbi,
      target: "all",
      program: programs.all,
      modules: apis.all,
    };
    Object.assign(globalThis, {
      __lucentModules: { runtime: { one: () => 1, Box }, __lucentIdentity },
    });
    try {
      const m = createRequire(import.meta.url)(path.join(out, "js/runtime.js")) as {
        one(): number;
        Box: new (n: number) => { n: number };
      };
      expect(m.one()).toBe(1);
      expect(new m.Box(2).n).toBe(2);
    } finally {
      delete (globalThis as { __lucentModules?: unknown }).__lucentModules;
    }
  });

  it("writes the build identity the proxies check the app's native code against", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lucent-pkg-"));
    const src = path.join(dir, "sample.lucent.ts");
    fs.writeFileSync(src, "export function one(): number { return 1; }");
    const out = path.join(dir, "native");
    const result = compile([src]);
    writeNativePackage(result, out);

    expect(fs.readFileSync(path.join(out, "js/sample.js"), "utf8")).toContain(
      'require("./_lucent/identity.js")',
    );
    expect(createRequire(import.meta.url)(path.join(out, "js/_lucent/identity.js"))).toEqual(
      result.identity,
    );
    expect(JSON.parse(fs.readFileSync(path.join(out, "manifest.json"), "utf8")).identity).toEqual(
      result.identity,
    );
  });

  it("points a Lucent package's proxies at the same loader", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lucent-pkg-"));
    const pkg = path.join(dir, "node_modules/lucent-a");
    fs.mkdirSync(path.join(pkg, "src"), { recursive: true });
    fs.writeFileSync(
      path.join(pkg, "package.json"),
      JSON.stringify({ name: "lucent-a", lucent: { sources: "src" } }),
    );
    const src = path.join(pkg, "src/storage.lucent.ts");
    fs.writeFileSync(src, "export function one(): number { return 1; }");
    const out = path.join(dir, "native");
    writeNativePackage(compile([src]), out);
    const proxy = fs.readFileSync(path.join(out, "js/lucent-a/storage.js"), "utf8");
    expect(proxy).toContain('require("../_lucent/runtime.js")');
    expect(proxy).toContain('require("../_lucent/identity.js")');
  });

  it("leaves the build outputs of the Android library alone", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lucent-pkg-"));
    const src = path.join(dir, "sample.lucent.ts");
    fs.writeFileSync(src, "export function one(): number { return 1; }");
    const out = path.join(dir, "native");
    writeNativePackage(compile([src]), out);
    // Gradle builds the package's android/ library in place.
    for (const f of [
      "android/build/intermediates/classes.jar",
      "android/.cxx/cache.json",
      "android/.gradle/state",
    ]) {
      fs.mkdirSync(path.dirname(path.join(out, f)), { recursive: true });
      fs.writeFileSync(path.join(out, f), "gradle");
    }
    const r = writeNativePackage(compile([src]), out);
    expect(r.removed).toEqual([]);
    expect(fs.existsSync(path.join(out, "android/build/intermediates/classes.jar"))).toBe(true);
  });

  it("keeps what JNI names from the app's shrinker (R8), through the library's consumer rules", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lucent-pkg-"));
    const src = path.join(dir, "sample.lucent.ts");
    fs.writeFileSync(src, "export function one(): number { return 1; }");
    const out = path.join(dir, "native");
    writeNativePackage(
      {
        ...compile([src]),
        javaKeep: [
          "androidx/core/content/ContextCompat",
          "android/net/ConnectivityManager$NetworkCallback",
        ],
      },
      out,
    );
    const rules = fs.readFileSync(path.join(out, "android/consumer-rules.pro"), "utf8");
    expect(rules).toContain("-keep class dev.lucent.** { *; }");
    expect(rules).toContain("-keep class androidx.core.content.ContextCompat { *; }");
    expect(rules).toContain("-keep class android.net.ConnectivityManager$NetworkCallback { *; }");
    expect(fs.readFileSync(path.join(out, "android/build.gradle"), "utf8")).toContain(
      'consumerProguardFiles "consumer-rules.pro"',
    );
  });

  it("declares the permissions the platform code needs in the library's manifest", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lucent-pkg-"));
    const src = path.join(dir, "sample.lucent.ts");
    fs.writeFileSync(src, "export function one(): number { return 1; }");
    const out = path.join(dir, "native");
    writeNativePackage(
      { ...compile([src]), androidPermissions: ["android.permission.USE_BIOMETRIC"] },
      out,
    );
    const manifest = fs.readFileSync(
      path.join(out, "android/src/main/AndroidManifest.xml"),
      "utf8",
    );
    expect(manifest).toContain(
      '<uses-permission android:name="android.permission.USE_BIOMETRIC" />',
    );
  });

  it("makes LucentNative depend on the pods its iOS code imports, once each", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lucent-pkg-"));
    const src = path.join(dir, "sample.lucent.ts");
    fs.writeFileSync(src, "export function one(): number { return 1; }");
    const plain = compile([src]);

    writeNativePackage({ ...plain, pods: ["WidgetsPod", "OtherPod"] }, path.join(dir, "out"), {
      native: nativeOf(["lucent-widgets", { ios: { pods: { WidgetsPod: "~> 1.0" } } }]),
    });
    const podspec = fs.readFileSync(path.join(dir, "out", "LucentNative.podspec"), "utf8");

    expect(podspec).toContain('s.dependency "WidgetsPod", "~> 1.0"');
    expect(podspec).toContain('s.dependency "OtherPod"\n');
    expect(podspec.match(/s\.dependency "WidgetsPod"/g)).toHaveLength(1);
  });

  it("builds the Swift shims into the pod when the program calls Swift-only members", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lucent-pkg-"));
    const src = path.join(dir, "sample.lucent.ts");
    fs.writeFileSync(src, "export function one(): number { return 1; }");
    const plain = compile([src]);
    writeNativePackage(plain, path.join(dir, "plain"));
    const podspec = (out: string) =>
      fs.readFileSync(path.join(dir, out, "LucentNative.podspec"), "utf8");
    expect(podspec("plain")).not.toContain("swift");
    const files = new Map([...plain.files, ["ios/LucentShims.swift", "import Foundation\n"]]);
    writeNativePackage({ ...plain, files }, path.join(dir, "shims"));
    expect(podspec("shims")).toMatch(/s\.source_files\s*=.*\bswift\b/);
    expect(podspec("shims")).toMatch(/s\.swift_version\s*=\s*"5\.\d+"/);
    // Its C++ headers stay out of the module Swift sees (it has no C++ interop).
    expect(podspec("shims")).toMatch(/s\.private_header_files\s*=\s*\["cpp\/\*\*\/\*\.\{h,inc\}"/);
    expect(fs.existsSync(path.join(dir, "shims/cpp/generated/ios/LucentShims.swift"))).toBe(true);
  });

  it("builds the Kotlin shims into the Android library when the program calls through them", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lucent-pkg-"));
    const src = path.join(dir, "sample.lucent.ts");
    fs.writeFileSync(src, "export function one(): number { return 1; }");
    const plain = compile([src]);
    const gradle = (out: string) =>
      fs.readFileSync(path.join(dir, out, "android/build.gradle"), "utf8");

    writeNativePackage(plain, path.join(dir, "plain"));
    expect(gradle("plain")).not.toContain("kotlin");

    const shim = "dev/lucent/shims/LucentShims_dev_orbit.kt";
    writeNativePackage(
      { ...plain, kotlin: new Map([[shim, "package dev.lucent.shims\n"]]) },
      path.join(dir, "shims"),
    );

    expect(gradle("shims")).toContain('apply plugin: "org.jetbrains.kotlin.android"');
    expect(gradle("shims")).toMatch(
      /implementation\("org\.jetbrains\.kotlinx:kotlinx-coroutines-core:[\d.]+"\)/,
    );
    expect(fs.existsSync(path.join(dir, "shims/android/src/main/java", shim))).toBe(true);
    // Kept from the app's shrinker with the rest of dev.lucent.
    expect(fs.readFileSync(path.join(dir, "shims/android/consumer-rules.pro"), "utf8")).toContain(
      "-keep class dev.lucent.** { *; }",
    );
  });

  it("writes Lucent packages' native needs into its build files", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lucent-pkg-"));
    const src = path.join(dir, "a.lucent.ts");
    fs.writeFileSync(src, "export function one(): number { return 1; }\n");
    const out = path.join(dir, "native");

    writeNativePackage({ ...compile([src]), frameworks: ["UIKit"] }, out, {
      native: nativeOf(
        [
          "lucent-auth",
          {
            ios: {
              pods: { LucentAuthKit: "~> 1.0" },
              frameworks: ["LocalAuthentication", "UIKit"],
              infoPlist: { NSFaceIDUsageDescription: "Unlock" },
            },
            android: {
              dependencies: { "androidx.biometric:biometric": "1.1.0" },
              permissions: ["android.permission.USE_BIOMETRIC"],
            },
          },
        ],
        [
          "lucent-vault",
          {
            ios: { pods: { LucentAuthKit: ">= 1.2" } },
            android: { dependencies: { "androidx.biometric:biometric": "1.2.0" } },
          },
        ],
      ),
    });

    const podspec = fs.readFileSync(path.join(out, "LucentNative.podspec"), "utf8");
    expect(podspec).toContain('s.dependency "LucentAuthKit", ">= 1.2", "~> 1.0"');
    expect(podspec).toContain(
      's.frameworks   = ["CoreFoundation", "LocalAuthentication", "UIKit"]',
    );

    const gradle = fs.readFileSync(path.join(out, "android/build.gradle"), "utf8");
    expect(gradle).toContain('api("androidx.biometric:biometric:1.1.0")');
    expect(gradle).toContain('api("androidx.biometric:biometric:1.2.0")');

    expect(
      fs.readFileSync(path.join(out, "android/src/main/AndroidManifest.xml"), "utf8"),
    ).toContain('android:name="android.permission.USE_BIOMETRIC"');
  });

  it("records what the packages contribute, and which package each need came from", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lucent-pkg-"));
    const src = path.join(dir, "a.lucent.ts");
    fs.writeFileSync(src, "export function one(): number { return 1; }\n");
    const out = path.join(dir, "native");

    writeNativePackage(compile([src]), out, {
      native: nativeOf([
        "lucent-auth",
        { ios: { infoPlist: { NSFaceIDUsageDescription: "Unlock" } } },
      ]),
    });

    const resolved = JSON.parse(fs.readFileSync(path.join(out, "resolved.json"), "utf8"));
    expect(resolved.packages).toEqual({ "lucent-auth": "1.0.0" });
    expect(resolved.ios.infoPlist).toEqual({
      NSFaceIDUsageDescription: { value: "Unlock", from: ["lucent-auth"] },
    });
    // No machine-specific path: the same inputs record the same file anywhere.
    expect(JSON.stringify(resolved)).not.toContain(os.tmpdir());
  });

  it("copies packages' native files in, and builds them into the pod and the Android library", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lucent-pkg-"));
    const out = path.join(dir, "native");

    writeNativePackage(program(dir), out, {
      native: nativeOf([
        "lucent-orbit",
        {
          ios: {
            nativeSources: ["native/ios"],
            resources: ["assets/beep.caf"],
            resourceBundles: { OrbitAssets: ["assets/ios"] },
            vendoredFrameworks: ["vendor/Orbit.xcframework"],
          },
          android: {
            nativeSources: ["native/android"],
            resources: ["res"],
            assets: ["assets/android"],
            libraries: ["libs/orbit.aar"],
            nativeLibraries: ["jniLibs"],
          },
        },
        {
          "native/ios/orbit.mm": "// ios\n",
          "native/android/dev/orbit/Orbit.kt": "package dev.orbit\n",
          "native/android/orbit_jni.cpp": "// android\n",
          "assets/beep.caf": "caf",
          "assets/ios/logo.png": "png",
          "vendor/Orbit.xcframework/Info.plist": "<plist/>",
          "res/drawable/orbit.png": "png",
          "assets/android/beep.ogg": "ogg",
          "libs/orbit.aar": "aar",
          "jniLibs/arm64-v8a/liborbit.so": "so",
        },
      ]),
    });

    const read = (f: string) => fs.readFileSync(path.join(out, f), "utf8");
    const pkg = "packages/lucent-orbit";

    // Each package's files under its own name.
    expect(read(`${pkg}/native/ios/orbit.mm`)).toBe("// ios\n");
    expect(read(`${pkg}/libs/orbit.aar`)).toBe("aar");

    const podspec = read("LucentNative.podspec");
    expect(podspec).toContain(`"${pkg}/native/ios/**/*.{h,hpp,m,mm,c,cc,cpp,swift}"`);
    expect(podspec).toContain(`\\"$(PODS_TARGET_SRCROOT)/${pkg}/native/ios\\"`);
    expect(podspec).toContain(`s.resources = ["${pkg}/assets/beep.caf"]`);
    expect(podspec).toContain(`s.resource_bundles = { "OrbitAssets" => ["${pkg}/assets/ios"] }`);
    expect(podspec).toContain(`s.vendored_frameworks = ["${pkg}/vendor/Orbit.xcframework"]`);

    const gradle = read("android/build.gradle");
    expect(gradle).toContain('apply plugin: "org.jetbrains.kotlin.android"');
    expect(gradle).toContain(`java.srcDirs += ["../${pkg}/native/android"]`);
    expect(gradle).toContain(`res.srcDirs += ["../${pkg}/res"]`);
    expect(gradle).toContain(`assets.srcDirs += ["../${pkg}/assets/android"]`);
    expect(gradle).toContain(`jniLibs.srcDirs += ["../${pkg}/jniLibs"]`);
    expect(gradle).toContain(`api(files("../${pkg}/libs/orbit.aar"))`);

    // C and C++ join the runtime's CMake target, with the package's directory for its headers.
    // The runtime traces into ATrace, which is in libandroid.
    expect(read("android/CMakeLists.txt")).toMatch(
      /target_link_libraries\(lucentnative [^)]*\bandroid\b/,
    );
    expect(read("android/CMakeLists.txt")).toContain(
      "include(${CMAKE_CURRENT_LIST_DIR}/packages.cmake OPTIONAL)",
    );
    const cmake = read("android/packages.cmake");
    expect(cmake).toContain(`\${LUCENT_ROOT}/${pkg}/native/android/orbit_jni.cpp`);
    expect(cmake).toMatch(
      /target_include_directories\(lucentnative PUBLIC\n\s+\$\{LUCENT_ROOT\}\/packages\/lucent-orbit\/native\/android\n/,
    );
    expect(cmake).not.toContain("Orbit.kt");
  });

  it.skipIf(!hasRuby)("writes a podspec Ruby parses", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lucent-pkg-"));
    const out = path.join(dir, "native");

    writeNativePackage(program(dir), out, {
      native: nativeOf([
        "lucent-orbit",
        {
          ios: {
            pods: { Kit: ">= 1.0, < 2" },
            deploymentTarget: "16.0",
            swiftPackages: {
              "https://github.com/orbit/orbit-swift": {
                requirement: { kind: "upToNextMajorVersion", minimumVersion: "1.2.0" },
                products: ["Orbit"],
              },
            },
            nativeSources: ["native/ios"],
            resources: ["assets/beep.caf"],
            resourceBundles: { OrbitAssets: ["assets/ios"] },
            vendoredFrameworks: ["vendor/Orbit.xcframework"],
          },
        },
        {
          "native/ios/orbit.swift": "import Foundation\n",
          "assets/beep.caf": "caf",
          "assets/ios/logo.png": "png",
          "vendor/Orbit.xcframework/Info.plist": "<plist/>",
        },
      ]),
    });

    const r = spawnSync("ruby", ["-c", path.join(out, "LucentNative.podspec")], {
      encoding: "utf8",
    });
    expect(r.stderr).toBe("");
    expect(r.status).toBe(0);
    // Swift sources make it a Swift pod.
    expect(fs.readFileSync(path.join(out, "LucentNative.podspec"), "utf8")).toContain(
      "s.swift_version",
    );
  });

  it("leaves out a package's files, and their build settings, once it stops listing them", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lucent-pkg-"));
    const out = path.join(dir, "native");
    const files = { "native/orbit.c": "int orbit;\n" };

    writeNativePackage(program(dir), out, {
      native: nativeOf(["lucent-orbit", { android: { nativeSources: ["native"] } }, files]),
    });
    expect(fs.existsSync(path.join(out, "packages/lucent-orbit/native/orbit.c"))).toBe(true);

    const r = writeNativePackage(program(dir), out, {
      native: nativeOf(["lucent-orbit", {}, files]),
    });

    expect(r.removed.map((f) => path.relative(out, f)).sort()).toEqual([
      "android/packages.cmake",
      "packages/lucent-orbit/native/orbit.c",
    ]);
    expect(fs.readFileSync(path.join(out, "android/build.gradle"), "utf8")).not.toContain(
      "srcDirs",
    );
  });

  it("declares Swift packages, and the highest target any package needs, in the podspec", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lucent-pkg-"));
    const out = path.join(dir, "native");

    writeNativePackage(program(dir), out, {
      native: nativeOf([
        "lucent-orbit",
        {
          ios: {
            deploymentTarget: "16.0",
            swiftPackages: {
              "https://github.com/orbit/orbit-swift": {
                requirement: { kind: "upToNextMajorVersion", minimumVersion: "1.2.0" },
                products: ["Orbit", "OrbitMaps"],
              },
            },
          },
        },
      ]),
    });

    const podspec = fs.readFileSync(path.join(out, "LucentNative.podspec"), "utf8");
    // Never lower than React Native's own minimum.
    expect(podspec).toContain(
      's.platforms    = { :ios => [min_ios_version_supported, "16.0"].max_by { |v| Gem::Version.new(v) } }',
    );
    expect(podspec).toContain(
      'spm_dependency(s, url: "https://github.com/orbit/orbit-swift", requirement: { kind: "upToNextMajorVersion", minimumVersion: "1.2.0" }, products: ["Orbit", "OrbitMaps"])',
    );
  });

  it("declares manifest components, and the highest minimum SDK, in the Android library", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lucent-pkg-"));
    const out = path.join(dir, "native");

    writeNativePackage(program(dir), out, {
      native: nativeOf([
        "lucent-orbit",
        {
          android: {
            minSdk: 26,
            permissions: ["android.permission.FOREGROUND_SERVICE"],
            components: [
              {
                kind: "service",
                name: "dev.orbit.SyncService",
                exported: false,
                foregroundServiceType: "dataSync",
              },
              {
                kind: "receiver",
                name: "dev.orbit.BootReceiver",
                exported: true,
                intentFilters: [{ actions: ["android.intent.action.BOOT_COMPLETED"] }],
                metaData: { "dev.orbit.mode": "boot" },
              },
            ],
          },
        },
      ]),
    });

    expect(fs.readFileSync(path.join(out, "android/build.gradle"), "utf8")).toContain(
      'minSdk Math.max(safeExtGet("minSdkVersion", 24) as int, 26)',
    );
    expect(fs.readFileSync(path.join(out, "android/src/main/AndroidManifest.xml"), "utf8")).toBe(
      [
        '<?xml version="1.0" encoding="utf-8"?>',
        "<!-- Generated by Lucent. Do not edit. -->",
        '<manifest xmlns:android="http://schemas.android.com/apk/res/android">',
        '  <uses-permission android:name="android.permission.FOREGROUND_SERVICE" />',
        "  <application>",
        '    <provider android:name="dev.lucent.LucentInitializer" android:exported="false" android:authorities="${applicationId}.lucent-initializer" />',
        '    <activity android:name="dev.lucent.LucentRequestActivity" android:exported="false" android:theme="@android:style/Theme.Translucent.NoTitleBar" android:configChanges="orientation|screenSize|screenLayout|smallestScreenSize|keyboardHidden" />',
        '    <receiver android:name="dev.orbit.BootReceiver" android:exported="true">',
        "      <intent-filter>",
        '        <action android:name="android.intent.action.BOOT_COMPLETED" />',
        "      </intent-filter>",
        '      <meta-data android:name="dev.orbit.mode" android:value="boot" />',
        "    </receiver>",
        '    <service android:name="dev.orbit.SyncService" android:exported="false" android:foregroundServiceType="dataSync" />',
        "  </application>",
        "</manifest>",
        "",
      ].join("\n"),
    );
  });

  it("declares the runtime's Activity tracking and request Activity in every app", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lucent-pkg-"));
    const out = path.join(dir, "native");

    writeNativePackage(program(dir), out);

    const manifest = fs.readFileSync(
      path.join(out, "android/src/main/AndroidManifest.xml"),
      "utf8",
    );
    // Started with the process, before any Activity or JavaScript: it sees the first Activity.
    expect(manifest).toContain(
      '<provider android:name="dev.lucent.LucentInitializer" android:exported="false" android:authorities="${applicationId}.lucent-initializer" />',
    );
    // Asks for results and permissions for Lucent code, whatever Activity the app has.
    expect(manifest).toContain('<activity android:name="dev.lucent.LucentRequestActivity"');
  });
});

describe("publishing the native package", () => {
  it("replaces each changed file whole, so a reader never sees half of one", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lucent-pkg-"));
    const src = path.join(dir, "a.lucent.ts");
    const out = path.join(dir, "native");

    fs.writeFileSync(src, "export function one(): number { return 1; }\n");
    writeNativePackage(compile([src]), out, {
      check: { inputs: "first", read: [], realpaths: [] },
    });

    // A reader holding the old file (a link to it) keeps reading the old file.
    const proxy = path.join(out, "js/a.js");
    const held = path.join(dir, "held.js");
    fs.linkSync(proxy, held);
    const before = fs.readFileSync(held, "utf8");

    fs.writeFileSync(
      src,
      "export function one(): number { return 1; }\nexport function two(): number { return 2; }\n",
    );
    const r = writeNativePackage(compile([src]), out, {
      check: { inputs: "second", read: [], realpaths: [] },
    });

    expect(fs.readFileSync(held, "utf8")).toBe(before);
    expect(fs.readFileSync(proxy, "utf8")).toContain("exports.two");
    expect(files(out).filter((f) => /\.tmp|~$/.test(f))).toEqual([]);

    // The manifest (Metro's cache key) comes last: proxies are in place when it changes.
    expect(path.relative(out, r.written.at(-1)!)).toBe("manifest.json");
  });
});
