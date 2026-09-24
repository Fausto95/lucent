import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vite-plus/test";
import {
  compile,
  type LucentPackage,
  lucentPackages,
  moduleNameOf,
  nativeDependencies,
  projectFiles,
  writeNativePackage,
} from "../src/index.ts";

/** An app whose node_modules has Lucent packages (a `lucent` field) and others. */
function app(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "lucent-pkgs-"));
  const write = (rel: string, text: string) => {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), text);
  };
  write(
    "package.json",
    JSON.stringify({ name: "app", dependencies: { "lucent-a": "1.0.0", "plain-js": "1.0.0" } }),
  );
  write("src/storage.lucent.ts", "export function where(): string { return 'app'; }\n");
  write(
    "node_modules/lucent-a/package.json",
    JSON.stringify({
      name: "lucent-a",
      version: "1.0.0",
      lucent: { sources: "src", compatible: ">=0.0.3" },
      dependencies: { "lucent-b": "1.0.0" },
    }),
  );
  write(
    "node_modules/lucent-a/src/storage.lucent.ts",
    "export function where(): string { return 'a'; }\n",
  );
  write(
    "node_modules/lucent-a/src/nested/deep.lucent.ts",
    "export function depth(): number { return 2; }\n",
  );
  write(
    "node_modules/lucent-b/package.json",
    JSON.stringify({ name: "lucent-b", version: "2.0.0", lucent: { sources: "lib" } }),
  );
  write(
    "node_modules/lucent-b/lib/storage.lucent.ts",
    "export function where(): string { return 'b'; }\n",
  );
  write(
    "node_modules/plain-js/package.json",
    JSON.stringify({ name: "plain-js", version: "1.0.0" }),
  );
  write("node_modules/plain-js/index.lucent.ts", "export function never(): number { return 0; }\n");
  return root;
}

describe("Lucent packages", () => {
  it("names a package's modules <package>/<module>, and the app's by their file", () => {
    const root = app();
    expect(moduleNameOf(path.join(root, "src/storage.lucent.ts"))).toBe("storage");
    expect(moduleNameOf(path.join(root, "node_modules/lucent-a/src/storage.lucent.ts"))).toBe(
      "lucent-a/storage",
    );
    expect(moduleNameOf(path.join(root, "node_modules/lucent-a/src/nested/deep.lucent.ts"))).toBe(
      "lucent-a/nested/deep",
    );
    expect(moduleNameOf(path.join(root, "node_modules/lucent-b/lib/storage.lucent.ts"))).toBe(
      "lucent-b/storage",
    );
  });

  it("finds the Lucent packages the app depends on, transitively, and nothing else", () => {
    const root = app();
    expect(lucentPackages(root).map((p) => `${p.name}@${p.version}`)).toEqual([
      "lucent-a@1.0.0",
      "lucent-b@2.0.0",
    ]);
    // Packages are where they really are (workspace links followed).
    const real = fs.realpathSync(root);
    expect(projectFiles(root).map((f) => path.relative(real, fs.realpathSync(f)))).toEqual([
      "node_modules/lucent-a/src/nested/deep.lucent.ts",
      "node_modules/lucent-a/src/storage.lucent.ts",
      "node_modules/lucent-b/lib/storage.lucent.ts",
      "src/storage.lucent.ts",
    ]);
  });

  it("compiles modules of the same name from different packages side by side", () => {
    const root = app();
    const r = compile(projectFiles(root));
    expect(r.diagnostics).toEqual([]);
    expect([...r.proxies.keys()].sort()).toEqual([
      "lucent-a/nested/deep",
      "lucent-a/storage",
      "lucent-b/storage",
      "storage",
    ]);
    expect(r.proxies.get("lucent-a/storage")).toContain('loadModule("lucent-a/storage"');
    const headers = [...r.files.keys()].filter((f) => f.endsWith(".h") && f !== "lucent_app.h");
    expect(new Set(headers).size).toBe(4);
  });

  it("lets Lucent modules import other packages' modules by path", () => {
    const root = app();
    fs.writeFileSync(
      path.join(root, "src/uses.lucent.ts"),
      'import { where } from "lucent-a/src/storage.lucent";\nimport { depth } from "lucent-a/src/nested/deep.lucent";\nexport function both(): string { return `${where()} ${depth()}`; }\n',
    );
    const r = compile(projectFiles(root));
    expect(r.diagnostics).toEqual([]);
    const uses = [...r.files.entries()].find(([k]) => k.endsWith("m_uses.cpp"))?.[1] ?? "";
    expect(uses).toMatch(/lucent_app::m_lucent_\w*storage::where\(\)/);
  });

  it("reads a package's lucent.json", () => {
    const root = app();
    fs.writeFileSync(
      path.join(root, "node_modules/lucent-b/lucent.json"),
      JSON.stringify({ android: { permissions: ["android.permission.VIBRATE"] } }),
    );
    expect(lucentPackages(root).find((p) => p.name === "lucent-b")?.native).toEqual({
      android: { permissions: ["android.permission.VIBRATE"] },
    });
  });

  it("fails for a package whose Lucent versions do not include this one, naming it", () => {
    const root = app();
    const pkg = path.join(root, "node_modules/lucent-b/package.json");
    fs.writeFileSync(
      pkg,
      JSON.stringify({
        name: "lucent-b",
        version: "2.0.0",
        lucent: { sources: "lib", compatible: "^9.0.0" },
      }),
    );
    expect(() => lucentPackages(root)).toThrow(
      /lucent-b@2\.0\.0 supports Lucent \^9\.0\.0, not \d+\.\d+\.\d+/,
    );
  });
});

describe("Lucent packages' native dependencies (lucent.json)", () => {
  const pkg = (name: string, native: object): LucentPackage & { native: object } => ({
    name,
    version: "1.0.0",
    dir: `/p/${name}`,
    sources: `/p/${name}/src`,
    native,
  });

  it("merges pods, Gradle artifacts, permissions and Info.plist entries", () => {
    const deps = nativeDependencies([
      pkg("lucent-auth", {
        ios: {
          pods: { LucentAuthKit: "~> 1.0" },
          infoPlist: { NSFaceIDUsageDescription: "Unlock with Face ID" },
        },
        android: {
          dependencies: { "androidx.biometric:biometric": "1.1.0" },
          permissions: ["android.permission.USE_BIOMETRIC"],
        },
      }),
      pkg("lucent-maps", {
        ios: { pods: { LucentAuthKit: "~> 1.0" } },
        android: { dependencies: { "com.google.android.gms:play-services-maps": "19.0.0" } },
      }),
    ]);
    expect(deps).toEqual({
      pods: { LucentAuthKit: "~> 1.0" },
      gradle: {
        "androidx.biometric:biometric": "1.1.0",
        "com.google.android.gms:play-services-maps": "19.0.0",
      },
      permissions: ["android.permission.USE_BIOMETRIC"],
      infoPlist: {
        NSFaceIDUsageDescription: { value: "Unlock with Face ID", from: "lucent-auth" },
      },
    });
  });

  it("fails when two packages want different versions of one dependency, naming both", () => {
    expect(() =>
      nativeDependencies([
        pkg("lucent-a", { ios: { pods: { Kit: "~> 1.0" } } }),
        pkg("lucent-b", { ios: { pods: { Kit: "~> 2.0" } } }),
      ]),
    ).toThrow(/pod Kit: lucent-a wants ~> 1\.0, lucent-b wants ~> 2\.0/);
    expect(() =>
      nativeDependencies([
        pkg("lucent-a", { android: { dependencies: { "g:a": "1" } } }),
        pkg("lucent-b", { android: { dependencies: { "g:a": "2" } } }),
      ]),
    ).toThrow(/g:a: lucent-a wants 1, lucent-b wants 2/);
  });

  it("writes them into the native package: podspec, library build.gradle and manifest, Info.plist entries", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lucent-pkgs-"));
    const src = path.join(dir, "a.lucent.ts");
    fs.writeFileSync(src, "export function one(): number { return 1; }\n");
    const out = path.join(dir, "native");
    const native = nativeDependencies([
      pkg("lucent-auth", {
        ios: {
          pods: { LucentAuthKit: "~> 1.0" },
          infoPlist: { NSFaceIDUsageDescription: "Unlock" },
        },
        android: {
          dependencies: { "androidx.biometric:biometric": "1.1.0" },
          permissions: ["android.permission.USE_BIOMETRIC"],
        },
      }),
    ]);
    writeNativePackage(compile([src]), out, { native });
    expect(fs.readFileSync(path.join(out, "LucentNative.podspec"), "utf8")).toContain(
      's.dependency "LucentAuthKit", "~> 1.0"',
    );
    expect(fs.readFileSync(path.join(out, "android/build.gradle"), "utf8")).toContain(
      'api("androidx.biometric:biometric:1.1.0")',
    );
    expect(
      fs.readFileSync(path.join(out, "android/src/main/AndroidManifest.xml"), "utf8"),
    ).toContain('android:name="android.permission.USE_BIOMETRIC"');
    expect(JSON.parse(fs.readFileSync(path.join(out, "manifest.json"), "utf8")).infoPlist).toEqual({
      NSFaceIDUsageDescription: { value: "Unlock", from: "lucent-auth" },
    });
  });
});
