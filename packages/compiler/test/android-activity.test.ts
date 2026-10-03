import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vite-plus/test";
import { androidJars, sdkAvailable } from "@lucent-lang/bindgen";
import { compile, runtimeDir } from "../src/index.ts";
import { runJavac } from "../../bindgen/test/jvm-tools.ts";

/** Android output for a platform module whose Android side is `src` (exporting run()). */
function android(src: string) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lucent-activity-"));
  const files = {
    "m.lucent.ts": "export declare function run(): Promise<string>;\n",
    "m.ios.lucent.ts": 'export async function run(): Promise<string> {\n  return "";\n}\n',
    "m.android.lucent.ts": src,
  };

  for (const [name, text] of Object.entries(files)) fs.writeFileSync(path.join(dir, name), text);

  const r = compile(
    Object.keys(files).map((f) => path.join(dir, f)),
    { platforms: ["android"] },
  );

  return { r, cpp: r.files.get("android/m_m.cpp") ?? "", dir };
}

const activity = `import { Intent } from "lucent:android/android.content";
import {
  currentActivity,
  onActivityEvent,
  requestPermissions,
  startActivityForResult,
} from "lucent:android";
import { main } from "lucent:thread";

export async function run(): Promise<string> {
  const events: string[] = [];
  const stopResumed = onActivityEvent("resumed", (activity) => {
    events.push(activity.getLocalClassName() ?? "");
  });
  const stopIntents = onActivityEvent("newIntent", (activity, intent) => {
    events.push(intent?.getAction() ?? "");
  });

  const name = await main(() => currentActivity()?.getLocalClassName() ?? "none");

  const pick = new Intent(Intent.ACTION_GET_CONTENT);
  pick.setType("*/*");
  const controller = new AbortController();
  const picked = await startActivityForResult(pick, controller.signal);

  const granted = await requestPermissions(["android.permission.CAMERA"]);

  stopResumed();
  stopIntents();

  return \`\${name} \${picked.getResultCode()} \${picked.getResultData()?.getDataString()} \${granted.join()} \${events.length}\`;
}
`;

/** The newest NDK's clang++, if the Android SDK has one. */
function ndkClang(): string | undefined {
  const root = path.join(
    process.env.ANDROID_HOME ?? path.join(os.homedir(), "Library/Android/sdk"),
    "ndk",
  );
  const ndk = fs.existsSync(root) ? fs.readdirSync(root).sort().pop() : undefined;
  if (!ndk) return undefined;

  const prebuilt = path.join(root, ndk, "toolchains/llvm/prebuilt");
  return fs.readdirSync(prebuilt).map((h) => path.join(prebuilt, h, "bin/clang++"))[0];
}

const NDK_FLAGS = [
  "--target=aarch64-linux-android24",
  "-std=c++20",
  "-ffp-contract=off",
  "-fsyntax-only",
  "-Werror",
  "-Wno-gnu-statement-expression",
  "-Wno-unused-label",
  "-Wno-parentheses-equality",
  "-Wno-comma",
];

describe.skipIf(!sdkAvailable("android"))("the current Activity, results and lifecycle", () => {
  it("gives Lucent code the current Activity, activity results, permissions and lifecycle events", () => {
    const { r, cpp } = android(activity);

    expect(r.diagnostics).toEqual([]);
    expect(cpp).toContain("lucent::jni::currentActivity()");
    expect(cpp).toContain("lucent::jni::startActivityForResult(");
    expect(cpp).toContain("lucent::jni::requestPermissions(");
    expect(cpp).toContain('lucent::jni::onActivityEvent(LUCENT_STR("resumed")');
  });

  it("compiles the generated glue and the runtime's Activity support with the NDK", () => {
    const clang = ndkClang();
    if (!clang) return;

    const { r, dir } = android(activity);
    expect(r.diagnostics).toEqual([]);

    for (const [k, v] of r.files) {
      fs.mkdirSync(path.dirname(path.join(dir, "out", k)), { recursive: true });
      fs.writeFileSync(path.join(dir, "out", k), v);
    }

    const include = [`-I${path.join(runtimeDir(), "cpp")}`, `-I${path.join(dir, "out/android")}`];

    for (const unit of [
      path.join(dir, "out/android/m_m.cpp"),
      path.join(runtimeDir(), "cpp/lucent/platform/android_activity.cpp"),
    ]) {
      const cc = spawnSync(clang, [...NDK_FLAGS, ...include, unit], { encoding: "utf8" });
      expect(cc.stderr).toBe("");
    }
  }, 120_000);

  it("ships Java for the Activity support that compiles against android.jar alone", () => {
    const jar = androidJars()?.[0];
    if (!jar || spawnSync("javac", ["-version"]).status !== 0) return;

    const java = path.join(runtimeDir(), "native/android/src/main/java/dev/lucent");
    const sources = fs.readdirSync(java).map((f) => path.join(java, f));
    expect(sources.map((f) => path.basename(f)).sort()).toEqual([
      "LucentActivities.java",
      "LucentChildren.java",
      "LucentHostView.java",
      "LucentInitializer.java",
      "LucentPackage.java",
      "LucentRequestActivity.java",
      "LucentSlotView.java",
      "LucentViewManager.java",
      "LucentViewManagers.java",
      "LucentViews.java",
      "NativeProxy.java",
    ]);

    // The package and the components' managers need React Native (the app's build compiles them); the rest only the platform.
    const reactNative = [
      "LucentHostView.java",
      "LucentPackage.java",
      "LucentViewManager.java",
      "LucentViewManagers.java",
      "LucentViews.java",
    ];
    const cc = runJavac([
      "--release",
      "11",
      "-Xlint:-options",
      "-Xlint:deprecation",
      "-Werror",
      "-cp",
      jar,
      "-d",
      fs.mkdtempSync(path.join(os.tmpdir(), "lucent-java-")),
      ...sources.filter((f) => !reactNative.includes(path.basename(f))),
    ]);
    expect(cc.stderr).toBe("");
  });
});
