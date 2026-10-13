import { describe, expect, it } from "vite-plus/test";
import { REQUIREMENTS } from "../packages/lucent/src/cli/doctor.ts";
import {
  appIdentity,
  checkFiles,
  PACKAGE_POD,
  packageFiles,
  podLine,
  windowApps,
} from "./window-app.ts";

describe("the window's apps", () => {
  it("are a bare app on each React Native release and an Expo app on each SDK, on each platform", () => {
    const apps = windowApps();
    const releases = (app: string) => [
      ...new Set(apps.filter((a) => a.app === app).map((a) => a.release)),
    ];

    expect(releases("bare")).toEqual([...REQUIREMENTS.reactNative.window]);
    expect(releases("expo")).toEqual(REQUIREMENTS.expoSdk.window.map(String));
    for (const app of apps)
      expect(apps.filter((a) => a.app === app.app && a.release === app.release)).toHaveLength(2);
  });

  it("build for iOS on a Mac and for Android on Linux, each under its own name", () => {
    const apps = windowApps();

    for (const app of apps)
      expect(app.runner).toBe(app.platform === "ios" ? "macos-26" : "ubuntu-latest");
    expect(new Set(apps.map((a) => a.name)).size).toBe(apps.length);
    expect(apps.map((a) => a.name)).toContain("Expo SDK 56 (iOS simulator)");
  });
});

describe("a window app's check", () => {
  it("knows each app's ids and Release build", () => {
    expect(appIdentity("bare", "/w/app")).toEqual({
      iosId: "org.reactjs.native.example.LucentWindow",
      androidId: "com.lucentwindow",
      process: "LucentWindow",
      ios: "/w/app/ios/build/Build/Products/Release-iphonesimulator/LucentWindow.app",
      android: "/w/app/android/app/build/outputs/apk/release/app-release.apk",
    });
    expect(appIdentity("expo", "/w/app")).toMatchObject({
      iosId: "dev.lucent.window",
      androidId: "dev.lucent.window",
    });
  });

  it("calls the scaffolded modules, mounts both components and logs a verdict", () => {
    const files = checkFiles();
    const app = files["App.tsx"]!;

    expect(Object.keys(files).sort()).toEqual([
      "App.tsx",
      "src/window-check.lucent.ts",
      "src/window-probe.lucent.tsx",
    ]);
    for (const used of [
      'from "./src/counter.lucent"',
      'from "./src/device.lucent"',
      'from "lucent:views/badge"',
      "<Badge ",
      "<WindowProbe ref={probe}",
      "LUCENT_PROGRESS tests",
      "LUCENT_SUMMARY tests",
    ])
      expect(app).toContain(used);
    expect(files["src/window-probe.lucent.tsx"]).toContain(
      'expose({ ping: (): string => "pong" })',
    );
  });

  it("depends on a Lucent package whose pod the Podfile installs from its path", () => {
    const files = packageFiles();

    expect(JSON.parse(files["packages/lucent-window-kit/lucent.json"]!)).toEqual({
      ios: { pods: { [PACKAGE_POD]: "~> 1.0" } },
    });
    expect(files["packages/lucent-window-kit/src/kit.lucent.ts"]).toContain(
      `from "lucent:ios/${PACKAGE_POD}"`,
    );
    expect(files[`pods/${PACKAGE_POD}/${PACKAGE_POD}.podspec`]).toContain(
      '"DEFINES_MODULE" => "YES"',
    );
    expect(checkFiles()["App.tsx"]).toContain('["package-pod", async () => kitAnswer() === 42]');

    const podfile = "platform :ios, '15.1'\n\ntarget 'LucentWindow' do\n  use_expo_modules!\nend\n";
    const out = podLine(podfile);

    expect(out).toBe(
      `platform :ios, '15.1'\n\ntarget 'LucentWindow' do\n  pod '${PACKAGE_POD}', :path => '../pods/${PACKAGE_POD}'\n  use_expo_modules!\nend\n`,
    );
    expect(podLine(out)).toBe(out);
  });
});
