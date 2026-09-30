import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vite-plus/test";
import { sdkAvailable } from "@lucent-lang/compiler";
import { runLucent } from "./run-to-exit.ts";

const fixtures = path.resolve(import.meta.dirname, "../../bindgen/test/fixtures");
const javac = spawnSync("javac", ["-version"]).status === 0;

function write(root: string, files: Record<string, string>): void {
  for (const [rel, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), text);
  }
}

/** An app with one installed Lucent package (lucent-orbit) whose lucent.json is `native`. */
function app(native: object): { root: string; pkg: string; cache: string } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "lucent-pkg-bindings-"));
  const pkg = path.join(root, "node_modules/lucent-orbit");

  write(root, {
    "package.json": JSON.stringify({ name: "app", dependencies: { "lucent-orbit": "1.0.0" } }),
    "node_modules/lucent-orbit/package.json": JSON.stringify({
      name: "lucent-orbit",
      version: "1.0.0",
      lucent: { sources: "src" },
    }),
    "node_modules/lucent-orbit/lucent.json": JSON.stringify(native),
    "node_modules/lucent-orbit/src/orbit.lucent.ts":
      "export function ready(): boolean { return true; }\n",
  });

  return { root, pkg, cache: fs.mkdtempSync(path.join(os.tmpdir(), "lucent-pkg-bindings-cache-")) };
}

function lucent(a: { root: string; cache: string }, ...args: string[]) {
  const r = runLucent([...args, "--root", a.root], {
    env: { ...process.env, NO_COLOR: "1", LUCENT_CACHE_DIR: a.cache },
  });

  return { status: r.status, out: r.stdout + r.stderr };
}

describe.skipIf(!javac || !sdkAvailable("android"))("a package's Android libraries", () => {
  it("are bindable without the app's resolved classpath", () => {
    const a = app({ android: { libraries: ["libs/widgets.jar"] } });
    const classes = path.join(a.root, "classes");
    const sources = spawnSync("find", [path.join(fixtures, "java"), "-name", "*.java"], {
      encoding: "utf8",
    })
      .stdout.trim()
      .split("\n");
    spawnSync("javac", ["--release", "11", "-d", classes, ...sources]);
    fs.mkdirSync(path.join(a.pkg, "libs"));
    spawnSync("jar", ["cf", path.join(a.pkg, "libs/widgets.jar"), "-C", classes, "."]);

    const r = lucent(a, "sdk", "show", "com.example.widgets.Widget");

    expect(r.out).toMatch(/export declare class Widget[\s\S]*getName\(\): string;/);
    expect(r.status).toBe(0);
  });
});

describe.skipIf(!sdkAvailable("ios"))("a package's vendored frameworks", () => {
  it("are bindable from their simulator slice", () => {
    const a = app({ ios: { vendoredFrameworks: ["vendor/Widgets.xcframework"] } });
    const slice = "node_modules/lucent-orbit/vendor/Widgets.xcframework/ios-arm64-simulator";

    write(a.root, {
      "node_modules/lucent-orbit/vendor/Widgets.xcframework/Info.plist": `<?xml version="1.0" encoding="UTF-8"?>
<plist version="1.0">
<dict>
  <key>AvailableLibraries</key>
  <array>
    <dict>
      <key>LibraryIdentifier</key>
      <string>ios-arm64-simulator</string>
      <key>LibraryPath</key>
      <string>Widgets.framework</string>
      <key>SupportedPlatform</key>
      <string>ios</string>
      <key>SupportedPlatformVariant</key>
      <string>simulator</string>
    </dict>
  </array>
</dict>
</plist>
`,
      [`${slice}/Widgets.framework/Headers/Widgets.h`]: fs.readFileSync(
        path.join(fixtures, "objc/Widgets/Widgets.h"),
        "utf8",
      ),
      [`${slice}/Widgets.framework/Modules/module.modulemap`]:
        'framework module Widgets {\n  umbrella header "Widgets.h"\n  export *\n}\n',
    });

    const r = lucent(a, "sdk", "show", "Widgets.WDGWidget");

    expect(r.out).toMatch(/export declare class WDGWidget/);
    expect(r.status).toBe(0);
  });
});
