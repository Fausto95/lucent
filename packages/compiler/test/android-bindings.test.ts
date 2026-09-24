import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vite-plus/test";
import { sdkAvailable } from "@lucent-lang/bindgen";
import { androidJars } from "@lucent-lang/bindgen";
import { compile, runtimeDir } from "../src/index.ts";

/** Android output for a platform module whose Android side is `src` (exporting run()). */
function android(src: string) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lucent-android-"));
  const files = {
    "m.lucent.ts": "export declare function run(): Promise<string>;\n",
    "m.ios.lucent.ts": 'export async function run(): Promise<string> {\n  return "";\n}\n',
    "m.android.lucent.ts": src,
  };
  for (const [name, text] of Object.entries(files)) fs.writeFileSync(path.join(dir, name), text);
  const r = compile(Object.keys(files).map((f) => path.join(dir, f)), { platforms: ["android"] });
  return { r, cpp: r.files.get("android/m_m.cpp") ?? "", dir };
}

const codes = (r: { diagnostics: { code: string }[] }) => r.diagnostics.map((d) => d.code);

const tracker = `import { Location, LocationListener, LocationManager } from "lucent:android/android.location";
import { appContext } from "lucent:android";
class Tracker implements LocationListener {
  fixes = 0;
  onLocationChanged(location: Location): void {
    this.fixes += location.getAccuracy() > 0 ? 1 : 0;
  }
  onProviderDisabled(provider: string): void {
    this.fixes = -1;
  }
}
export async function run(): Promise<string> {
  const tracker = new Tracker();
  const manager = appContext().getSystemService(LocationManager);
  manager?.requestLocationUpdates(LocationManager.GPS_PROVIDER, 1000, 0, tracker);
  manager?.removeUpdates(tracker);
  return \`\${tracker.fixes}\`;
}
`;

const watcher = `import { ConnectivityManager, ConnectivityManager_NetworkCallback, Network } from "lucent:android/android.net";
import { appContext } from "lucent:android";
class Watcher extends ConnectivityManager_NetworkCallback {
  events: string[] = [];
  constructor() {
    super();
  }
  onAvailable(network: Network): void {
    this.events.push(\`available \${network.toString()}\`);
  }
  onLost(network: Network): void {
    this.events.push("lost");
  }
}
export async function run(): Promise<string> {
  const manager = appContext().getSystemService(ConnectivityManager);
  const watcher = new Watcher();
  manager?.registerDefaultNetworkCallback(watcher);
  manager?.unregisterNetworkCallback(watcher);
  return watcher.events.join(",");
}
`;

const listener = `import { Location, LocationManager } from "lucent:android/android.location";
import { Context } from "lucent:android/android.content";
import { appContext } from "lucent:android";
export async function run(): Promise<string> {
  const manager = appContext().getSystemService(LocationManager);
  let latest = "";
  const onLocation = (location: Location) => {
    latest = \`\${location.getLatitude()},\${location.getLongitude()}\`;
  };
  manager?.requestLocationUpdates(LocationManager.GPS_PROVIDER, 1000, 0, onLocation);
  manager?.removeUpdates(onLocation);
  return \`\${latest} \${Context.LOCATION_SERVICE}\`;
}
`;

describe.skipIf(!sdkAvailable("android"))("Android bindings from android.jar", () => {
  it("passes CharSequence as strings", () => {
    const { r, cpp } = android(`import { ClipData } from "lucent:android/android.content";
export async function run(): Promise<string> {
  const clip = ClipData.newPlainText("label", "text");
  return clip?.getItemAt(0)?.getText() ?? "";
}
`);
    expect(r.diagnostics).toEqual([]);
    expect(cpp).toContain('"(Ljava/lang/CharSequence;Ljava/lang/CharSequence;)Landroid/content/ClipData;"');
    expect(cpp).toContain("lucent::jni::charSequenceToString");
  });

  it("inlines compile-time constants", () => {
    const { r, cpp } = android(`import { Context } from "lucent:android/android.content";
export async function run(): Promise<string> {
  return Context.VIBRATOR_SERVICE;
}
`);
    expect(r.diagnostics).toEqual([]);
    expect(cpp).toContain('"vibrator"');
    expect(cpp).not.toContain('"VIBRATOR_SERVICE"');
  });

  it("prefers int among overloads of numbers, and calls renamed overloads by their Java name", () => {
    const { r, cpp } = android(`import { Intent } from "lucent:android/android.content";
export async function run(): Promise<string> {
  new Intent().putExtra("a", 1).putExtra_string_long("b", 2);
  return "";
}
`);
    expect(r.diagnostics).toEqual([]);
    expect(cpp).toContain('"putExtra", "(Ljava/lang/String;I)Landroid/content/Intent;"');
    expect(cpp).toContain('"putExtra", "(Ljava/lang/String;J)Landroid/content/Intent;"');
  });

  it("copies byte[] as Uint8Array and String[] as string[]", () => {
    const { r, cpp } = android(`import { Build } from "lucent:android/android.os";
import { Base64 } from "lucent:android/android.util";
export async function run(): Promise<string> {
  const encoded = Base64.encodeToString(new Uint8Array([104, 105]), Base64.NO_WRAP) ?? "";
  const decoded = Base64.decode(encoded, Base64.NO_WRAP);
  return \`\${encoded} \${decoded?.length} \${(Build.SUPPORTED_ABIS ?? []).join(",")}\`;
}
`);
    expect(r.diagnostics).toEqual([]);
    expect(cpp).toContain("lucent::jni::toByteArray");
    expect(cpp).toContain("lucent::jni::fromByteArray");
    expect(cpp).toContain("lucent::jni::fromStringArray");
  });

  it("reads instance fields", () => {
    const { r, cpp } = android(`import { appContext } from "lucent:android";
export async function run(): Promise<string> {
  const context = appContext();
  const info = context.getPackageManager()?.getPackageInfo(context.getPackageName() ?? "", 0);
  return \`\${info?.versionName ?? "?"} \${info?.firstInstallTime}\`;
}
`);
    expect(r.diagnostics).toEqual([]);
    expect(cpp).toContain('"versionName", "Ljava/lang/String;"');
    expect(cpp).toContain("GetLongField");
  });

  it("types interfaces and calls them through the interface", () => {
    const { r, cpp } = android(`import { Uri } from "lucent:android/android.net";
import type { Parcelable } from "lucent:android/android.os";
export async function run(): Promise<string> {
  const p: Parcelable | null = Uri.parse("https://example.com");
  return \`\${p?.describeContents()}\`;
}
`);
    expect(r.diagnostics).toEqual([]);
    expect(cpp).toContain('"android/os/Parcelable"');
    expect(cpp).toContain('"describeContents", "()I"');
  });

  it("requires a guard for APIs newer than the minimum SDK", () => {
    const unguarded = android(`import { VibrationEffect } from "lucent:android/android.os";
export async function run(): Promise<string> {
  VibrationEffect.createOneShot(10, 10);
  return "";
}
`);
    expect(codes(unguarded.r)).toEqual(["LUCENT3007"]);
    expect(unguarded.r.diagnostics[0]!.message).toMatch(/VibrationEffect.*API 26.*available\("android", 26\)/);

    const guarded = android(`import { Build_VERSION, VibrationEffect, Vibrator, VibratorManager } from "lucent:android/android.os";
import { appContext, available } from "lucent:android";
export async function run(): Promise<string> {
  const context = appContext();
  const v = available("android", 31) ? context.getSystemService(VibratorManager)?.defaultVibrator : context.getSystemService(Vibrator);
  if (Build_VERSION.SDK_INT >= 29) v?.vibrate(VibrationEffect.createPredefined(VibrationEffect.EFFECT_CLICK));
  if (!available("android", 26)) return "old";
  v?.vibrate(VibrationEffect.createOneShot(10, VibrationEffect.DEFAULT_AMPLITUDE));
  return "";
}
`);
    expect(guarded.r.diagnostics).toEqual([]);
  });

  it("passes functions where Java takes an interface with one abstract method", () => {
    const { r, cpp } = android(listener);
    expect(r.diagnostics).toEqual([]);
    // One proxy per function, so removeUpdates gets the object requestLocationUpdates did.
    expect(cpp).toContain('lucent::jni::proxyFor(env, "android/location/LocationListener"');
    // Keyed by name and parameters: the default onLocationChanged(List) keeps its Java body.
    expect(cpp).toMatch(/\{"onLocationChanged\(Landroid\/location\/Location;\)", \[f_\]\(JNIEnv\* env, jobjectArray args_\) -> jobject \{/);
    expect(cpp).toContain("lucent::postCallback(");
  });

  it("declares the permissions of the SDK methods it calls", () => {
    const { r } = android(`import { BiometricManager, BiometricManager_Authenticators as Authenticators } from "lucent:android/android.hardware.biometrics";
import { appContext, available } from "lucent:android";
export async function run(): Promise<string> {
  if (!available("android", 30)) return "";
  return \`\${appContext().getSystemService(BiometricManager)?.canAuthenticate(Authenticators.BIOMETRIC_WEAK)}\`;
}
`);
    expect(r.diagnostics).toEqual([]);
    expect(r.androidPermissions).toEqual(["android.permission.USE_BIOMETRIC"]);
  });

  it("names the Java classes the glue uses by name, for the app's shrinker to keep", () => {
    const { r } = android(tracker);
    expect(r.javaKeep).toEqual(expect.arrayContaining(["android/location/LocationListener", "android/location/LocationManager"]));
  });

  it("implements Java interfaces with Lucent classes, one proxy per instance", () => {
    const { r, cpp } = android(tracker);
    expect(r.diagnostics).toEqual([]);
    expect(cpp).toContain('lucent::jni::proxyFor(lucent::jni::env(), "android/location/LocationListener", o_.get(), {');
    expect(cpp).toMatch(/\{"onLocationChanged\(Landroid\/location\/Location;\)", \[s_ = o_\]\(JNIEnv\* env, jobjectArray args_\) -> jobject \{/);
    expect(cpp).toContain('{"onProviderDisabled(Ljava/lang/String;)", ');
  });

  it("extends abstract SDK classes with Lucent classes, through a generated Java subclass", () => {
    const { r, cpp } = android(watcher);
    expect(r.diagnostics).toEqual([]);
    const java = r.java?.get("dev/lucent/generated/Watcher.java") ?? "";
    expect(java).toContain("public final class Watcher extends android.net.ConnectivityManager.NetworkCallback {");
    expect(java).toContain("  public void onAvailable(android.net.Network a0) {");
    expect(java).toContain('    NativeProxy.dispatch(handle, "onAvailable(Landroid/net/Network;)", new Object[] {a0});');
    // Methods the Lucent class leaves out keep the SDK's body.
    expect(java).not.toContain("onUnavailable");
    expect(cpp).toContain('lucent::jni::subclassFor(lucent::jni::env(), "dev/lucent/generated/Watcher", o_.get(), {');
    const jar = androidJars()?.[0];
    if (!jar || spawnSync("javac", ["-version"]).status !== 0) return;
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lucent-java-"));
    fs.mkdirSync(path.join(dir, "src/dev/lucent/generated"), { recursive: true });
    fs.writeFileSync(path.join(dir, "src/dev/lucent/generated/Watcher.java"), java);
    const cc = spawnSync("javac", ["--release", "11", "-Xlint:-options", "-cp", jar, "-d", path.join(dir, "out"), path.join(runtimeDir(), "native/android/src/main/java/dev/lucent/NativeProxy.java"), path.join(dir, "src/dev/lucent/generated/Watcher.java")], { encoding: "utf8" });
    expect(cc.stderr).toBe("");
  });

  it("ships a NativeProxy that compiles against android.jar", () => {
    const jar = androidJars()?.[0];
    if (!jar || spawnSync("javac", ["-version"]).status !== 0) return;
    const out = fs.mkdtempSync(path.join(os.tmpdir(), "lucent-java-"));
    const cc = spawnSync("javac", ["--release", "11", "-Xlint:-options", "-cp", jar, "-d", out, path.join(runtimeDir(), "native/android/src/main/java/dev/lucent/NativeProxy.java")], { encoding: "utf8" });
    expect(cc.stderr).toBe("");
  });

  it("generates JNI C++ that compiles with the NDK", () => {
    const ndkRoot = path.join(process.env.ANDROID_HOME ?? path.join(os.homedir(), "Library/Android/sdk"), "ndk");
    const ndk = fs.existsSync(ndkRoot) ? fs.readdirSync(ndkRoot).sort().pop() : undefined;
    if (!ndk) return;
    const bin = fs.readdirSync(path.join(ndkRoot, ndk, "toolchains/llvm/prebuilt")).map((h) => path.join(ndkRoot, ndk, "toolchains/llvm/prebuilt", h, "bin/clang++"))[0]!;
    const calls = `import { ClipData, Context, Intent } from "lucent:android/android.content";
import { Uri } from "lucent:android/android.net";
import { Build, Vibrator } from "lucent:android/android.os";
import { Base64 } from "lucent:android/android.util";
import { appContext } from "lucent:android";
export async function run(): Promise<string> {
  const context = appContext();
  const info = context.getPackageManager()?.getPackageInfo(context.getPackageName() ?? "", 0);
  new Intent().putExtra("a", 1).putExtra_string_long("b", 2);
  const bytes = Base64.decode(Base64.encodeToString(new Uint8Array([1, 2]), Base64.NO_WRAP) ?? "", 0);
  // Optional calls of void methods are values too.
  appContext().getSystemService(Vibrator)?.cancel();
  // A native value whose type is not nullable, compared with null.
  if (appContext() === null) return "";
  // The checker narrows Build.MODEL here; the glue still returns string | null.
  if (Build.MODEL) return Build.MODEL;
  return \`\${ClipData.newPlainText("l", "t")?.getItemAt(0)?.getText()} \${Context.VIBRATOR_SERVICE} \${info?.versionName} \${bytes?.length} \${Uri.parse("x")?.describeContents()} \${(Build.SUPPORTED_ABIS ?? []).join()}\`;
}
`;
    // Lucent names the JNI glue uses (env), or that look like its temporaries.
    const shadowing = `import { Build } from "lucent:android/android.os";
export async function run(): Promise<string> {
  const env = "x";
  const r_ = Build.MODEL ?? env;
  return r_;
}
`;
    for (const src of [calls, listener, tracker, watcher, shadowing]) {
      const { r, dir } = android(src);
      expect(r.diagnostics).toEqual([]);
      for (const [k, v] of r.files) {
        fs.mkdirSync(path.dirname(path.join(dir, "out", k)), { recursive: true });
        fs.writeFileSync(path.join(dir, "out", k), v);
      }
      const cc = spawnSync(
        bin,
        ["--target=aarch64-linux-android24", "-std=c++20", "-fsyntax-only", "-Werror", "-Wno-gnu-statement-expression", "-Wno-unused-label", "-Wno-parentheses-equality", "-Wno-comma", `-I${path.join(runtimeDir(), "cpp")}`, `-I${path.join(dir, "out/android")}`, path.join(dir, "out/android/m_m.cpp")],
        { encoding: "utf8" },
      );
      expect(cc.stderr).toBe("");
    }
  });
});
