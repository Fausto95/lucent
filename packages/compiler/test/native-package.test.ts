import fs from "node:fs";
import { createRequire } from "node:module";
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

  it("writes the lucent:core declarations for the app's tsconfig paths", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lucent-pkg-"));
    const src = path.join(dir, "sample.lucent.ts");
    fs.writeFileSync(src, "export function one(): number { return 1; }");
    const out = path.join(dir, "native");
    writeNativePackage(compile([src]), out);
    expect(fs.readFileSync(path.join(out, "types/core.d.ts"), "utf8")).toContain("export declare function delay(");
  });

  it("ships the JS loader its proxies require, so apps install no Lucent runtime package", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lucent-pkg-"));
    // A module may be named like the loader without clashing with it.
    const src = path.join(dir, "runtime.lucent.ts");
    fs.writeFileSync(src, "export function one(): number { return 1; }\nexport class Box { constructor(readonly n: number) {} }\n");
    const out = path.join(dir, "native");
    writeNativePackage(compile([src]), out);
    const proxy = fs.readFileSync(path.join(out, "js/runtime.js"), "utf8");
    expect(proxy).not.toContain("@lucent-lang/runtime");
    expect(proxy).toContain('require("./_lucent/runtime.js")');
    // The proxy runs against the native module through the loader.
    const Box = function Box(n: number) {
      return { n };
    };
    Object.assign(globalThis, { __lucentModules: { runtime: { one: () => 1, Box } } });
    try {
      const m = createRequire(import.meta.url)(path.join(out, "js/runtime.js")) as { one(): number; Box: new (n: number) => { n: number } };
      expect(m.one()).toBe(1);
      expect(new m.Box(2).n).toBe(2);
    } finally {
      delete (globalThis as { __lucentModules?: unknown }).__lucentModules;
    }
  });

  it("points a Lucent package's proxies at the same loader", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lucent-pkg-"));
    const pkg = path.join(dir, "node_modules/lucent-a");
    fs.mkdirSync(path.join(pkg, "src"), { recursive: true });
    fs.writeFileSync(path.join(pkg, "package.json"), JSON.stringify({ name: "lucent-a", lucent: { sources: "src" } }));
    const src = path.join(pkg, "src/storage.lucent.ts");
    fs.writeFileSync(src, "export function one(): number { return 1; }");
    const out = path.join(dir, "native");
    writeNativePackage(compile([src]), out);
    expect(fs.readFileSync(path.join(out, "js/lucent-a/storage.js"), "utf8")).toContain('require("../_lucent/runtime.js")');
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
