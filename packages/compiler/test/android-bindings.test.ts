import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
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

describe("Android bindings from android.jar", () => {
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

  it("generates JNI C++ that compiles with the NDK", () => {
    const ndkRoot = path.join(process.env.ANDROID_HOME ?? path.join(os.homedir(), "Library/Android/sdk"), "ndk");
    const ndk = fs.existsSync(ndkRoot) ? fs.readdirSync(ndkRoot).sort().pop() : undefined;
    if (!ndk) return;
    const bin = fs.readdirSync(path.join(ndkRoot, ndk, "toolchains/llvm/prebuilt")).map((h) => path.join(ndkRoot, ndk, "toolchains/llvm/prebuilt", h, "bin/clang++"))[0]!;
    const { r, dir } = android(`import { ClipData, Context, Intent } from "lucent:android/android.content";
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
  // The checker narrows Build.MODEL here; the glue still returns string | null.
  if (Build.MODEL) return Build.MODEL;
  return \`\${ClipData.newPlainText("l", "t")?.getItemAt(0)?.getText()} \${Context.VIBRATOR_SERVICE} \${info?.versionName} \${bytes?.length} \${Uri.parse("x")?.describeContents()} \${(Build.SUPPORTED_ABIS ?? []).join()}\`;
}
`);
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
  });
});
