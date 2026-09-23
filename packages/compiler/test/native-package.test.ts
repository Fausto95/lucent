import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { compile, runtimeDir, writeNativePackage } from "../src/index.ts";

function files(dir: string): string[] {
  return fs.readdirSync(dir, { recursive: true, withFileTypes: true }).filter((e) => e.isFile()).map((e) => path.relative(dir, path.join(e.parentPath, e.name)));
}

describe("native package", () => {
  it("ships every runtime source file", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lucent-pkg-"));
    const src = path.join(dir, "sample.lucent.ts");
    fs.writeFileSync(src, "export function one(): number { return 1; }");
    const out = path.join(dir, "native");
    writeNativePackage(compile([src]), out);
    for (const sub of ["cpp/lucent", "cpp/rn", "cpp/third_party"]) {
      expect(files(path.join(out, sub)).sort()).toEqual(files(path.join(runtimeDir(), sub)).sort());
    }
  });

  it("leaves the build outputs of the Android library alone", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lucent-pkg-"));
    const src = path.join(dir, "sample.lucent.ts");
    fs.writeFileSync(src, "export function one(): number { return 1; }");
    const out = path.join(dir, "native");
    writeNativePackage(compile([src]), out);
    // Gradle builds the package's android/ library in place.
    for (const f of ["android/build/intermediates/classes.jar", "android/.cxx/cache.json", "android/.gradle/state"]) {
      fs.mkdirSync(path.dirname(path.join(out, f)), { recursive: true });
      fs.writeFileSync(path.join(out, f), "gradle");
    }
    const r = writeNativePackage(compile([src]), out);
    expect(r.removed).toEqual([]);
    expect(fs.existsSync(path.join(out, "android/build/intermediates/classes.jar"))).toBe(true);
  });

  it("keeps what JNI names from the app's shrinker (R8), through the library's consumer rules", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lucent-pkg-"));
    const src = path.join(dir, "sample.lucent.ts");
    fs.writeFileSync(src, "export function one(): number { return 1; }");
    const out = path.join(dir, "native");
    writeNativePackage({ ...compile([src]), javaKeep: ["androidx/core/content/ContextCompat", "android/net/ConnectivityManager$NetworkCallback"] }, out);
    const rules = fs.readFileSync(path.join(out, "android/consumer-rules.pro"), "utf8");
    expect(rules).toContain("-keep class dev.lucent.** { *; }");
    expect(rules).toContain("-keep class androidx.core.content.ContextCompat { *; }");
    expect(rules).toContain("-keep class android.net.ConnectivityManager$NetworkCallback { *; }");
    expect(fs.readFileSync(path.join(out, "android/build.gradle"), "utf8")).toContain('consumerProguardFiles "consumer-rules.pro"');
  });

  it("declares the permissions the platform code needs in the library's manifest", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lucent-pkg-"));
    const src = path.join(dir, "sample.lucent.ts");
    fs.writeFileSync(src, "export function one(): number { return 1; }");
    const out = path.join(dir, "native");
    writeNativePackage({ ...compile([src]), androidPermissions: ["android.permission.USE_BIOMETRIC"] }, out);
    const manifest = fs.readFileSync(path.join(out, "android/src/main/AndroidManifest.xml"), "utf8");
    expect(manifest).toContain('<uses-permission android:name="android.permission.USE_BIOMETRIC" />');
  });
});
