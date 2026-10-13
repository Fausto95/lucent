import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vite-plus/test";
import type { ResolvedNative } from "@lucent-lang/compiler";
import { mainActivityOf, missingMainActivity } from "../src/cli/project.ts";

/*
 * What Lucent packages need on a bare app's main Activity (lucent.json's
 * android.mainActivity): lucent build names what the app's manifest lacks,
 * as it names Info.plist entries, since the manifest is the app's.
 */

const manifest = (
  attributes: string,
) => `<manifest xmlns:android="http://schemas.android.com/apk/res/android">
  <application>
    <activity android:name=".SettingsActivity" android:exported="false" />
    <activity
      android:name=".MainActivity"
      ${attributes}
      android:exported="true">
      <intent-filter>
        <action android:name="android.intent.action.MAIN" />
        <category android:name="android.intent.category.LAUNCHER" />
      </intent-filter>
    </activity>
  </application>
</manifest>
`;

function bareApp(text: string): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "lucent-main-activity-"));
  fs.mkdirSync(path.join(root, "android/app/src/main"), { recursive: true });
  fs.writeFileSync(path.join(root, "android/app/src/main/AndroidManifest.xml"), text);
  return root;
}

const needs = (mainActivity: ResolvedNative["android"]["mainActivity"]) =>
  ({ android: { mainActivity } }) as ResolvedNative;

describe("the main Activity's attributes", () => {
  it("finds the Activity the launcher opens", () => {
    const main = mainActivityOf(manifest('android:launchMode="singleTask"'));
    expect(main?.name).toBe(".MainActivity");
    expect(main?.attributes.get("android:launchMode")).toBe("singleTask");
    expect(mainActivityOf("<manifest><application/></manifest>")).toBeUndefined();
  });

  it("names what packages need that the app's manifest lacks, and keeps its launch mode", () => {
    const root = bareApp(
      manifest('android:configChanges="orientation|screenSize" android:launchMode="singleTask"'),
    );
    const warned = missingMainActivity(
      root,
      needs({
        supportsPictureInPicture: ["lucent-video"],
        configChanges: { orientation: ["lucent-video"], uiMode: ["lucent-theme"] },
        launchMode: { value: "singleTop", from: ["lucent-video"] },
      }),
    ).map((n) => n.text);

    const file = path.join("android", "app", "src", "main", "AndroidManifest.xml");
    expect(warned).toEqual([
      `lucent-video needs android:supportsPictureInPicture="true" on .MainActivity in ${file} (the Expo config plugin adds it)`,
      `lucent-theme needs "uiMode" in android:configChanges on .MainActivity in ${file} (the Expo config plugin adds it)`,
      `lucent-video needs android:launchMode="singleTop" on .MainActivity in ${file}, which says singleTask: the app's stands`,
    ]);
  });

  it("says nothing when the manifest has them, or no package asks", () => {
    const root = bareApp(
      manifest(
        'android:supportsPictureInPicture="true" android:configChanges="uiMode|orientation"',
      ),
    );
    expect(
      missingMainActivity(
        root,
        needs({ supportsPictureInPicture: ["lucent-video"], configChanges: { uiMode: ["a"] } }),
      ),
    ).toEqual([]);
    expect(missingMainActivity(root, needs({ configChanges: {} }))).toEqual([]);
  });
});
