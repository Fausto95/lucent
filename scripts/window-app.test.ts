import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vite-plus/test";
import { REQUIREMENTS } from "../packages/lucent/src/cli/doctor.ts";
import { missingGradlePlugins } from "../packages/lucent/src/cli/project.ts";
import {
  addNamedGradleLines,
  androidConfigurationGaps,
  appIdentity,
  checkFiles,
  GRADLE_PLUGIN,
  googleServices,
  META_DATA,
  OPTION_VALUE,
  PACKAGE_POD,
  packageConfiguration,
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

    expect(JSON.parse(files["packages/lucent-window-kit/lucent.json"]!)).toEqual(
      packageConfiguration(),
    );
    expect(packageConfiguration()).toMatchObject({ ios: { pods: { [PACKAGE_POD]: "~> 1.0" } } });
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

describe("the package's native configuration in a window app", () => {
  it("is each piece, and the app sets its option", () => {
    const files = packageFiles();
    expect(Object.keys(packageConfiguration())).toEqual(["options", "ios", "android"]);
    expect(Object.keys((packageConfiguration() as { android: object }).android)).toEqual([
      "queries",
      "features",
      "metaData",
      "gradlePlugins",
    ]);
    expect(JSON.parse(files["lucent.json"]!)).toEqual({
      packages: { "lucent-window-kit": { key: OPTION_VALUE } },
    });
    expect(JSON.parse(googleServices("com.lucentwindow")).client[0].client_info).toMatchObject({
      android_client_info: { package_name: "com.lucentwindow" },
    });
  });

  it("adds to a bare app the Gradle lines lucent build names", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lucent-window-gradle-"));
    const project =
      'buildscript {\n    dependencies {\n        classpath("com.android.tools.build:gradle")\n    }\n}\n';
    fs.mkdirSync(path.join(dir, "android/app"), { recursive: true });
    fs.writeFileSync(path.join(dir, "android/build.gradle"), project);
    fs.writeFileSync(
      path.join(dir, "android/app/build.gradle"),
      'apply plugin: "com.android.application"\n',
    );
    const native = {
      android: {
        gradlePlugins: {
          [GRADLE_PLUGIN[0]]: { value: GRADLE_PLUGIN[1], from: ["lucent-window-kit"] },
        },
      },
    } as unknown as Parameters<typeof missingGradlePlugins>[1];
    // What lucent build prints, as its notices.
    const out = missingGradlePlugins(dir, native)
      .map((n) => `! ${n.text}`)
      .join("\n");

    expect(addNamedGradleLines(dir, out)).toEqual([
      path.join("android", "build.gradle"),
      path.join("android", "app", "build.gradle"),
    ]);
    expect(fs.readFileSync(path.join(dir, "android/build.gradle"), "utf8")).toContain(
      `        classpath("${GRADLE_PLUGIN[1]}")\n        classpath("com.android.tools.build:gradle")`,
    );
    expect(fs.readFileSync(path.join(dir, "android/app/build.gradle"), "utf8")).toBe(
      `apply plugin: "com.android.application"\napply plugin: "${GRADLE_PLUGIN[0]}"\n`,
    );
    // Then the build has them.
    expect(missingGradlePlugins(dir, native)).toEqual([]);
  });

  it("finds each piece in an Android build, and names the ones it lacks", () => {
    const manifest = `<manifest>
    <queries>
        <package android:name="com.android.chrome" />
    </queries>
    <uses-feature
        android:name="android.hardware.camera"
        android:required="false" />
    <application>
        <meta-data
            android:name="${META_DATA}"
            android:value="${OPTION_VALUE}" />
    </application>
</manifest>
`;
    const values =
      '<resources><string name="google_app_id" translatable="false">1:0:android:0</string></resources>';

    expect(androidConfigurationGaps(manifest, values)).toEqual([]);
    expect(
      androidConfigurationGaps(manifest.replace(OPTION_VALUE, "the default"), "<resources/>"),
    ).toEqual([
      `the merged manifest has no ${META_DATA} meta-data of ${OPTION_VALUE}`,
      `${GRADLE_PLUGIN[0]} wrote no google_app_id: the app's build does not apply it`,
    ]);
  });
});
