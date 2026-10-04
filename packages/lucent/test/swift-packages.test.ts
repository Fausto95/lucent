/**
 * A Swift package an app adds in Xcode, bound by rule (TA32): Lucent reads
 * the app's project and Package.resolved, builds the package's products
 * for the app's deployment target, and binds what they declare, an API
 * newer than that target under an availability check.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vite-plus/test";
import { compile, sdkAvailable, sdkModule, writeNativePackage } from "@lucent-lang/compiler";
import { projectSdk } from "../src/cli/project.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
const xcodebuild = spawnSync("xcodebuild", ["-version"]).status === 0 && sdkAvailable("ios");

const git = (cwd: string, ...args: string[]) => {
  const r = spawnSync("git", args, { cwd, encoding: "utf8" });
  if (r.status !== 0) throw new Error(`git ${args.join(" ")}: ${r.stderr}`);
  return r.stdout.trim();
};

/** An app whose Xcode project links the Gauges package, tagged 1.0.0 in a repository of its own. */
function app(): string {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "lucent-spm-")));
  const repo = path.join(root, "gauges.git");

  fs.cpSync(path.join(here, "fixtures/spm/Gauges"), repo, { recursive: true });
  git(repo, "init", "-q");
  git(repo, "-c", "user.email=t@t", "-c", "user.name=t", "add", ".");
  git(repo, "-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "Gauges");
  git(repo, "tag", "1.0.0");
  const revision = git(repo, "rev-parse", "HEAD");

  const ios = path.join(root, "ios");
  const fixture = path.join(here, "../../bindgen/test/fixtures/xcode/ios");
  fs.cpSync(fixture, ios, { recursive: true });

  const project = path.join(ios, "App.xcodeproj/project.pbxproj");
  fs.writeFileSync(
    project,
    fs
      .readFileSync(project, "utf8")
      .replace("https://github.com/acme/Gauges.git", `file://${repo}`)
      .replace("minimumVersion = 1.2.0", "minimumVersion = 1.0.0"),
  );
  fs.writeFileSync(
    path.join(ios, "App.xcworkspace/xcshareddata/swiftpm/Package.resolved"),
    JSON.stringify({
      pins: [
        {
          identity: "gauges",
          kind: "remoteSourceControl",
          location: `file://${repo}`,
          state: { revision, version: "1.0.0" },
        },
      ],
      version: 3,
    }),
  );
  fs.writeFileSync(path.join(root, "package.json"), JSON.stringify({ name: "@acme/app" }));

  return root;
}

/** The app's module, its iOS body `body`, compiled against the project's SDK. */
function compiled(root: string, body: string) {
  const files = {
    "m.lucent.ts": "export declare function run(): number;\n",
    "m.ios.lucent.ts": `import { available } from "lucent:ios";\nimport { Gauge } from "lucent:ios/Gauges";\n\nexport function run(): number {\n  const gauge = new Gauge(2);\n${body}\n}\n`,
    "m.android.lucent.ts": "export function run(): number {\n  return 0;\n}\n",
  };
  for (const [f, text] of Object.entries(files)) fs.writeFileSync(path.join(root, f), text);

  const sdk = projectSdk(root);
  return {
    sdk,
    r: compile(
      Object.keys(files).map((f) => path.join(root, f)),
      { platforms: ["ios"], deferred: ["android"], sdk },
    ),
  };
}

describe.skipIf(!xcodebuild)("an app's Swift package", () => {
  const root = app();

  it("is built for the app's target and bound by rule, from the version Package.resolved pins", () => {
    const { sdk, r } = compiled(root, "  return gauge.steady();");
    const gauges = sdkModule("ios", "Gauges", sdk);

    expect(r.diagnostics).toEqual([]);
    expect("schema" in gauges && gauges.schema.provenance).toMatchObject({
      artifact: "spm:gauges@1.0.0",
      target: "arm64-apple-ios16.4-simulator",
    });
  }, 900_000);

  it("is linked by the native package, at the version the app resolved, for the app's target", () => {
    const { sdk, r } = compiled(root, "  return gauge.steady();");
    const out = path.join(root, ".lucent/native");

    writeNativePackage(r, out, {
      app: {
        deploymentTarget: sdk.ios!.deploymentTarget!,
        swiftPackages: sdk.ios!.swiftPackages!.pins,
      },
    });
    const podspec = fs.readFileSync(path.join(out, "LucentNative.podspec"), "utf8");

    expect(r.swiftPackages).toEqual(["gauges@1.0.0"]);
    expect(podspec).toContain(
      `spm_dependency(s, url: ${JSON.stringify(`file://${path.join(root, "gauges.git")}`)}, requirement: { kind: "exactVersion", version: "1.0.0" }, products: ["Gauges"])`,
    );
    expect(podspec).toContain('[min_ios_version_supported, "16.4"]');
  }, 900_000);

  it("needs an availability check for an API newer than the app's target", () => {
    expect(compiled(root, "  return gauge.doubled();").r.diagnostics).toEqual([
      expect.objectContaining({
        code: "LUCENT3007",
        message: expect.stringMatching(/needs iOS 17(\.0)? \(apps run from iOS 16\.4\)/),
      }),
    ]);
    expect(
      compiled(root, '  return available("ios", 17) ? gauge.doubled() : gauge.steady();').r
        .diagnostics,
    ).toEqual([]);
  }, 900_000);
});
