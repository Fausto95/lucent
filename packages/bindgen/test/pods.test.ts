/**
 * What the Pods xcconfigs say about pods whose modules are not there
 * before Xcode builds them: Swift pods built as static libraries, and
 * pods shipping an XCFramework, which CocoaPods copies into the build
 * directory. Read from the files CocoaPods writes, on any machine.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vite-plus/test";
import { podsSearchPaths } from "../src/pods.ts";

const fixtures = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures");
const app = path.join(fixtures, "pods-static");
const ios = path.join(app, "ios");

describe("pods Xcode builds into its products directory", () => {
  const pods = podsSearchPaths(ios)!;

  it("finds a Swift pod built as a static library: its target, module and sources", () => {
    expect(pods.swiftPods).toEqual([
      {
        pod: "dial-kit",
        target: "dial-kit",
        module: "DialKit",
        sources: [path.join(app, "dial-kit/ios/Dial.swift")],
      },
    ]);
  });

  it("finds a pod's XCFramework through its simulator slice", () => {
    const slice = path.join(ios, "Pods/OrbitSDK/OrbitSDK.xcframework/ios-arm64_x86_64-simulator");
    expect(pods.xcframeworks).toEqual([
      {
        pod: "OrbitSDK",
        xcframework: path.join(ios, "Pods/OrbitSDK/OrbitSDK.xcframework"),
        searchPath: slice,
      },
    ]);
    // On the framework search paths, as a prebuilt framework is.
    expect(pods.frameworkPaths).toContain(slice);
  });

  it("finds neither in an app without them", () => {
    const plain = podsSearchPaths(path.join(fixtures, "pods"))!;
    expect(plain.swiftPods).toEqual([]);
    expect(plain.xcframeworks).toEqual([]);
  });
});

describe("Swift pods built as frameworks (use_frameworks!)", () => {
  it("finds an all-Swift pod's framework as a Swift pod, a mixed one's as its headers", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lucent-pods-"));
    fs.cpSync(path.join(fixtures, "pods-frameworks"), dir, { recursive: true });
    const support = path.join(dir, "ios/Pods/Target Support Files");

    // spin-kit: Swift only, so CocoaPods's umbrella header imports nothing.
    fs.mkdirSync(path.join(support, "spin-kit"));
    fs.writeFileSync(
      path.join(support, "spin-kit/spin-kit.modulemap"),
      'framework module SpinKit {\n  umbrella header "spin-kit-umbrella.h"\n  export *\n}\n',
    );
    fs.writeFileSync(
      path.join(support, "spin-kit/spin-kit-umbrella.h"),
      "#import <UIKit/UIKit.h>\nFOUNDATION_EXPORT double SpinKitVersionNumber;\n",
    );
    fs.writeFileSync(
      path.join(support, "spin-kit/spin-kit.debug.xcconfig"),
      "PODS_ROOT = ${SRCROOT}\nPODS_TARGET_SRCROOT = ${PODS_ROOT}/../../spin-kit\nPRODUCT_MODULE_NAME = SpinKit\n",
    );
    fs.mkdirSync(path.join(dir, "spin-kit"));
    fs.writeFileSync(path.join(dir, "spin-kit/Spin.swift"), "public struct Spin {}\n");
    const app = path.join(support, "Pods-App/Pods-App.debug.xcconfig");
    fs.writeFileSync(
      app,
      fs
        .readFileSync(app, "utf8")
        .replace(
          '"${PODS_CONFIGURATION_BUILD_DIR}/gauge-kit"',
          '"${PODS_CONFIGURATION_BUILD_DIR}/gauge-kit" "${PODS_CONFIGURATION_BUILD_DIR}/spin-kit"',
        ),
    );

    const pods = podsSearchPaths(path.join(dir, "ios"))!;
    // gauge-kit's umbrella imports its headers: an Objective-C framework, as before.
    expect(pods.frameworks.map((f) => f.module)).toEqual(["GaugeKit"]);
    expect(pods.swiftPods).toEqual([
      {
        pod: "spin-kit",
        target: "spin-kit",
        module: "SpinKit",
        sources: [path.join(dir, "spin-kit/Spin.swift")],
      },
    ]);
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
