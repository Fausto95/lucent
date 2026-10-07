// A SwiftUI component written in Lucent, run: the Toggle fixture's
// generated Swift, setup and component view, hosted by LucentComponentView
// on Mac Catalyst in a hidden window (swiftui_run_test.mm drives it as
// React Native's mounting manager does). Its hosting controller is the
// child of the view controller it shows in, appears and disappears with
// it, shows VoiceOver its body's elements, takes its traits and the
// host's layout direction, and goes with its mount; its props, commands
// and actions reach SwiftUI, and nothing reaches the mount once it ended.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vite-plus/test";
import { compile, runtimeDir, sdkAvailable } from "../../src/index.ts";
import { catalystObjects, macosSdk, quickjsSources } from "./mount-harness.ts";
import { catalystToolchain, reactCommon } from "./react-native-headers.ts";
import { TOGGLE } from "./swiftui-fixture.ts";

const toolchain = catalystToolchain();
const ios = process.platform === "darwin" && sdkAvailable("ios");

/** Every step of the driver, in order. */
const EXPECTED = [
  "mounted: controller yes, parent none, appearance none",
  "in a window: parent LucentTestParent, appearance willAppear didAppear",
  "accessibility: host an element no, reads A: 0 taps",
  "dark window: controller dark",
  "host right to left: controller right to left, back: left to right",
  "prop: wider",
  "command toggle: resized",
  "action: off again",
  "size reports to the parent: 0",
  "parent disappeared, appeared: willDisappear didDisappear willAppear didAppear",
  "pushed: parent the screen, appearance willAppear didAppear",
  "popped: parent the screen, appearance willDisappear didDisappear",
  "removed: parent LucentTestParent, appearance willDisappear didDisappear",
  "back: parent LucentTestParent, appearance willAppear didAppear",
  "recycled: parent none, content gone, late action and report ignored",
  "released: controller gone, view gone",
  "remounted: new controller yes, parent LucentTestParent",
  "two: parents LucentTestParent, LucentTestParent, distinct yes",
  "hosts gone: controllers gone, native references all released",
];

/** A Mac Catalyst app's bundle: its scene is the driver's, it never shows a window. */
const INFO_PLIST = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleIdentifier</key><string>dev.lucent.test.swiftui-run</string>
  <key>CFBundleExecutable</key><string>swiftui_run</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>LSUIElement</key><true/>
  <key>UIApplicationSceneManifest</key>
  <dict>
    <key>UIApplicationSupportsMultipleScenes</key><false/>
    <key>UISceneConfigurations</key>
    <dict>
      <key>UIWindowSceneSessionRoleApplication</key>
      <array>
        <dict>
          <key>UISceneConfigurationName</key><string>Test</string>
          <key>UISceneDelegateClassName</key><string>LucentTestScene</string>
        </dict>
      </array>
    </dict>
  </dict>
</dict>
</plist>
`;

describe("a SwiftUI component in its iOS host", () => {
  it.skipIf(!toolchain || !ios)(
    "is contained, follows its parent and its host, and goes with its mount",
    () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lucent-swiftui-run-"));

      fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify({ name: "@acme/app" }));
      for (const [name, text] of Object.entries(TOGGLE))
        fs.writeFileSync(path.join(dir, name), text);

      const result = compile(
        Object.keys(TOGGLE).map((f) => path.join(dir, f)),
        { platforms: ["ios"] },
      );

      expect(result.diagnostics).toEqual([]);

      const out = path.join(dir, "out");
      for (const [f, text] of result.files) {
        fs.mkdirSync(path.dirname(path.join(out, f)), { recursive: true });
        fs.writeFileSync(path.join(out, f), text);
      }

      const registration = result.components![0]!.registration;
      const driver = path.join(out, "ios/driver.mm");

      fs.writeFileSync(
        driver,
        fs
          .readFileSync(path.join(import.meta.dirname, "swiftui_run_test.mm"), "utf8")
          .replaceAll("TOGGLE", registration),
      );

      // The generated Swift and the driver's probe, one module.
      const sdk = macosSdk();
      const support = path.join(sdk, "System/iOSSupport");
      const target = "arm64-apple-ios15.1-macabi";
      const swiftObject = path.join(dir, "swift.o");
      const swiftc = spawnSync(
        "xcrun",
        [
          "swiftc",
          "-c",
          "-parse-as-library",
          "-whole-module-optimization",
          "-warnings-as-errors",
          "-swift-version",
          "5",
          "-module-name",
          "LucentSwiftUIRun",
          "-target",
          target,
          "-sdk",
          sdk,
          "-Fsystem",
          path.join(support, "System/Library/Frameworks"),
          "-I",
          path.join(support, "usr/lib/swift"),
          ...[...result.files.keys()]
            .filter((f) => f.endsWith(".swift"))
            .map((f) => path.join(out, f)),
          path.join(import.meta.dirname, "swiftui_run_probe.swift"),
          "-o",
          swiftObject,
        ],
        { encoding: "utf8" },
      );

      expect(swiftc.stderr).toBe("");

      // The runtime, its JSI boundary, the host, the module and its views.
      const cpp = path.join(runtimeDir(), "cpp");
      const rn = path.join(cpp, "rn");
      const sources = [
        ...fs
          .readdirSync(path.join(cpp, "lucent"))
          .filter((f) => f.endsWith(".cpp"))
          .map((f) => path.join(cpp, "lucent", f)),
        path.join(cpp, "lucent/jsi/host.cpp"),
        path.join(cpp, "lucent/jsi/convert.cpp"),
        path.join(cpp, "lucent/platform/ios.mm"),
        path.join(cpp, "lucent/platform/ios_ui.mm"),
        path.join(rn, "LucentViewRequests.cpp"),
        ...fs
          .readdirSync(rn)
          .filter((f) => f.endsWith(".mm"))
          .map((f) => path.join(rn, f)),
        ...[...result.files.keys()]
          .filter((f) => /\.(cpp|mm)$/.test(f))
          .map((f) => path.join(out, f)),
        driver,
      ];

      const app = path.join(dir, "SwiftUIRun.app/Contents");
      const binary = path.join(app, "MacOS/swiftui_run");
      const swiftLibraries = path.join(
        path.dirname(spawnSync("xcrun", ["-f", "swiftc"], { encoding: "utf8" }).stdout.trim()),
        "../lib/swift/macosx",
      );

      fs.mkdirSync(path.dirname(binary), { recursive: true });
      fs.writeFileSync(path.join(app, "Info.plist"), INFO_PLIST);

      const args = [
        "-fobjc-arc",
        "-iframework",
        path.join(support, "System/Library/Frameworks"),
        `-F${path.join(support, "System/Library/Frameworks")}`,
        "-isystem",
        path.join(support, "usr/include"),
        "-isystem",
        path.join(reactCommon(), "react/utils/platform/ios"),
        // The app builds Lucent's modules without -Werror.
        "-Wno-unused-variable",
      ];
      const objects = catalystObjects(
        dir,
        args,
        [...sources, ...quickjsSources()],
        path.join(out, "ios"),
      );
      const link = spawnSync(
        toolchain!.command,
        [
          ...toolchain!.args,
          ...args,
          ...objects,
          swiftObject,
          "-framework",
          "UIKit",
          "-framework",
          "SwiftUI",
          "-framework",
          "Foundation",
          "-framework",
          "CoreFoundation",
          "-framework",
          "CoreGraphics",
          // Swift's libraries: Mac Catalyst's, the system's, and the toolchain's back-deployment ones.
          `-L${path.join(support, "usr/lib/swift")}`,
          `-L${path.join(sdk, "usr/lib/swift")}`,
          `-L${swiftLibraries}`,
          "-Wl,-rpath,/System/iOSSupport/usr/lib/swift",
          "-Wl,-rpath,/usr/lib/swift",
          "-o",
          binary,
        ],
        { encoding: "utf8" },
      );

      expect(link.stderr).toBe("");

      const run = spawnSync(binary, [], { encoding: "utf8", timeout: 60_000 });

      expect(run.stdout.trim().split("\n"), run.stderr).toEqual(EXPECTED);
      expect(run.status).toBe(0);
      // A command reaching the recycled view: no mount to run it.
      expect(run.stderr).toContain(
        "[lucent] command toggle reached a view with no mount (its setup failed, or it is not mounted yet)",
      );

      fs.rmSync(dir, { recursive: true, force: true });
    },
    900_000,
  );
});
