/** The permissions a use of an annotated Android API declares in the manifest (fixture SDK). */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vite-plus/test";
import { forgetLoadedSdks } from "@lucent-lang/bindgen";
import { fakeAndroidSdk, javac } from "../../bindgen/test/java-fixtures.ts";
import { runJar } from "../../bindgen/test/jvm-tools.ts";
import { android } from "./android-harness.ts";

const NET = {
  "dev/example/net/Radio.java": `package dev.example.net;
public class Radio {
  public Radio() {}
  public String getNetwork() { return ""; }
  public boolean isOnline() { return true; }
  public int getLevel() { return 0; }
  public void setLevel(int level) {}
  public static final String ACTION_SCAN = "dev.example.SCAN";
}
`,
};

const ANNOTATIONS = `<root>
  <item name="dev.example.net.Radio java.lang.String getNetwork()">
    <annotation name="androidx.annotation.RequiresPermission">
      <val name="value" val="&quot;android.permission.ACCESS_NETWORK_STATE&quot;" />
    </annotation>
  </item>
  <item name="dev.example.net.Radio boolean isOnline()">
    <annotation name="androidx.annotation.RequiresPermission">
      <val name="allOf" val="{&quot;android.permission.ACCESS_WIFI_STATE&quot;, &quot;android.permission.INTERNET&quot;}" />
    </annotation>
  </item>
  <item name="dev.example.net.Radio void setLevel(int)">
    <annotation name="androidx.annotation.RequiresPermission">
      <val name="value" val="&quot;android.permission.CHANGE_NETWORK_STATE&quot;" />
    </annotation>
  </item>
</root>
`;

function sdk() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "lucent-permissions-"));
  const sdkRoot = fakeAndroidSdk(path.join(root, "sdk"), "android-36", NET);
  const annotations = path.join(root, "annotations");
  fs.mkdirSync(path.join(annotations, "dev/example/net"), { recursive: true });
  fs.writeFileSync(path.join(annotations, "dev/example/net/annotations.xml"), ANNOTATIONS);
  fs.mkdirSync(path.join(sdkRoot, "platforms/android-36/data"), { recursive: true });
  runJar([
    "cfM",
    path.join(sdkRoot, "platforms/android-36/data/annotations.zip"),
    "-C",
    annotations,
    ".",
  ]);
  forgetLoadedSdks();
  return { android: { sdkRoots: [sdkRoot] }, cacheDir: path.join(root, "cache") };
}

const use = (body: string) =>
  android(
    `import { Radio } from "lucent:android/dev.example.net";
export async function run(): Promise<string> {
  const r = new Radio();
  ${body}
}
`,
    sdk(),
  ).r;

describe.skipIf(!javac)("Android permissions", () => {
  it("are declared for the getters property reads call, as for the getters' calls", () => {
    const read = use("return `${r.network} ${r.online}`;");
    const called = use("return `${r.getNetwork()}`;");

    expect(read.diagnostics).toEqual([]);
    expect(read.androidPermissions).toEqual([
      "android.permission.ACCESS_NETWORK_STATE",
      "android.permission.ACCESS_WIFI_STATE",
      "android.permission.INTERNET",
    ]);
    expect(called.androidPermissions).toEqual(["android.permission.ACCESS_NETWORK_STATE"]);
  });

  it("are declared for the setter a property write calls, not for its read", () => {
    expect(use('r.setLevel(2);\n  return "";').androidPermissions).toEqual([
      "android.permission.CHANGE_NETWORK_STATE",
    ]);
    expect(use("return `${r.level}`;").androidPermissions).toEqual([]);
  });
});
