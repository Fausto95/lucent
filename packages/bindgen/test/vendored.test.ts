import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vite-plus/test";
import { forgetLoadedSdks, sdkAvailable, sdkModule, sdkModuleArtifacts } from "../src/provider.ts";
import { frameworkSearchPath } from "../src/vendored.ts";
import { runJar, runJavac } from "./jvm-tools.ts";

const fixtures = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures");
const javac =
  spawnSync("javac", ["-version"]).status === 0 && spawnSync("jar", ["--version"]).status === 0;
const xcode = sdkAvailable("ios");
const androidSdk = sdkAvailable("android");

const made: string[] = [];
const tmp = (prefix: string) => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  made.push(d);
  return d;
};
afterAll(() => made.forEach((d) => fs.rmSync(d, { recursive: true, force: true })));

function write(root: string, files: Record<string, string>): void {
  for (const [rel, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), text);
  }
}

/** A header-only framework (headers and module map), as the fixture Widgets module declares it. */
function framework(dir: string, name = "Widgets"): Record<string, string> {
  const widgets = path.join(fixtures, "objc/Widgets");

  return {
    [`${dir}/${name}.framework/Headers/Widgets.h`]: fs.readFileSync(
      path.join(widgets, "Widgets.h"),
      "utf8",
    ),
    [`${dir}/${name}.framework/Modules/module.modulemap`]: `framework module ${name} {\n  umbrella header "Widgets.h"\n  export *\n}\n`,
  };
}

/** An XCFramework's Info.plist listing `slices` (identifier → variant, none for a device). */
function xcframeworkPlist(name: string, slices: Record<string, string | undefined>): string {
  const libraries = Object.entries(slices)
    .map(
      ([id, variant]) => `
    <dict>
      <key>LibraryIdentifier</key>
      <string>${id}</string>
      <key>LibraryPath</key>
      <string>${name}.framework</string>
      <key>SupportedArchitectures</key>
      <array><string>arm64</string></array>
      <key>SupportedPlatform</key>
      <string>ios</string>${variant ? `\n      <key>SupportedPlatformVariant</key>\n      <string>${variant}</string>` : ""}
    </dict>`,
    )
    .join("");

  return `<?xml version="1.0" encoding="UTF-8"?>
<plist version="1.0">
<dict>
  <key>AvailableLibraries</key>
  <array>${libraries}
  </array>
  <key>CFBundlePackageType</key>
  <string>XFWK</string>
</dict>
</plist>
`;
}

describe("vendored frameworks' search paths", () => {
  it("searches a .framework's directory", () => {
    const root = tmp("lucent-vendored-");
    write(root, framework("vendor"));

    expect(frameworkSearchPath(path.join(root, "vendor/Widgets.framework"))).toBe(
      path.join(root, "vendor"),
    );
  });

  it("searches an XCFramework's simulator slice, as its Info.plist names it", () => {
    const root = tmp("lucent-vendored-");
    const xc = "vendor/Widgets.xcframework";
    write(root, {
      [`${xc}/Info.plist`]: xcframeworkPlist("Widgets", {
        "ios-arm64": undefined,
        "ios-arm64_x86_64-simulator": "simulator",
      }),
      ...framework(`${xc}/ios-arm64`),
      ...framework(`${xc}/ios-arm64_x86_64-simulator`),
    });

    expect(frameworkSearchPath(path.join(root, xc))).toBe(
      path.join(root, xc, "ios-arm64_x86_64-simulator"),
    );
  });

  it("has none for an XCFramework without a simulator slice", () => {
    const root = tmp("lucent-vendored-");
    const xc = "vendor/Widgets.xcframework";
    write(root, {
      [`${xc}/Info.plist`]: xcframeworkPlist("Widgets", { "ios-arm64": undefined }),
      ...framework(`${xc}/ios-arm64`),
    });

    expect(frameworkSearchPath(path.join(root, xc))).toBeUndefined();
  });

  it.skipIf(!xcode)("binds the module of a vendored XCFramework's slice", () => {
    const root = tmp("lucent-vendored-");
    const xc = "vendor/Widgets.xcframework";
    write(root, {
      [`${xc}/Info.plist`]: xcframeworkPlist("Widgets", {
        "ios-arm64_x86_64-simulator": "simulator",
      }),
      ...framework(`${xc}/ios-arm64_x86_64-simulator`),
    });
    forgetLoadedSdks();

    const r = sdkModule("ios", "Widgets", {
      cacheDir: tmp("lucent-cache-"),
      ios: { frameworkPaths: [frameworkSearchPath(path.join(root, xc))!] },
    });

    expect("schema" in r && r.schema.types.some((t) => t.name === "WDGWidget")).toBe(true);
    expect("schema" in r && r.schema.provenance?.artifact).toBe("framework:Widgets");
  });
});

describe.skipIf(!javac || !androidSdk)("libraries packages ship", () => {
  function fixtureJar(dir: string): string {
    const sources = spawnSync("find", [path.join(fixtures, "java"), "-name", "*.java"], {
      encoding: "utf8",
    })
      .stdout.trim()
      .split("\n");
    const classes = path.join(dir, "classes");
    const cc = runJavac(["--release", "11", "-d", classes, ...sources]);
    if (cc.status !== 0) throw new Error(cc.stderr);

    const jar = path.join(dir, "widgets.jar");
    runJar(["cf", jar, "-C", classes, "."]);
    return jar;
  }

  it("binds a package's jars and AARs without the app's classpath", () => {
    const dir = tmp("lucent-libraries-");
    const jar = fixtureJar(dir);
    forgetLoadedSdks();

    const r = sdkModule("android", "com.example.widgets", {
      cacheDir: tmp("lucent-cache-"),
      android: { libraries: [jar] },
    });

    expect("schema" in r && r.schema.types.some((t) => t.name === "Widget")).toBe(true);
  });

  it("reads a library once when the app's classpath has it too", () => {
    const dir = tmp("lucent-libraries-");
    const jar = fixtureJar(dir);
    // Gradle's copy of the same library, as the classpath lists it.
    const copy = path.join(dir, "copy/widgets.jar");
    fs.mkdirSync(path.dirname(copy));
    fs.copyFileSync(jar, copy);
    const classpath = path.join(dir, "android-classpath.json");
    fs.writeFileSync(classpath, JSON.stringify({ jars: [copy], aars: [] }));
    forgetLoadedSdks();

    const sdk = { cacheDir: tmp("lucent-cache-"), android: { libraries: [jar], classpath } };
    const r = sdkModule("android", "com.example.widgets", sdk);

    expect("schema" in r).toBe(true);
    expect(
      sdkModuleArtifacts("android", "com.example.widgets", sdk).filter((a) => a.kind !== "sdk"),
    ).toHaveLength(1);
  });
});
