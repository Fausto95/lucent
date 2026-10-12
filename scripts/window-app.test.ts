import { describe, expect, it } from "vite-plus/test";
import { REQUIREMENTS } from "../packages/lucent/src/cli/doctor.ts";
import { windowApps } from "./window-app.ts";

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
