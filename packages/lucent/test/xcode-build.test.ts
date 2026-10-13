import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vite-plus/test";
import {
  compile,
  POD_INSTALL_RECORD,
  podSourcesDigest,
  writeNativePackage,
} from "@lucent-lang/compiler";
import { podInstallStale, xcodeIssue } from "../src/cli/commands/build-check.ts";
import { unboundPods, uninstalledPods } from "../src/cli/project.ts";

/** A project's native package, as lucent build writes it, and its directory. */
function nativePackage(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lucent-xcode-"));
  const src = path.join(dir, "a.lucent.ts");
  fs.writeFileSync(src, "export function one(): number { return 1; }\n");
  const native = path.join(dir, ".lucent/native");
  writeNativePackage(compile([src]), native, { root: dir });
  return native;
}

describe("lucent build in Xcode's build phase", () => {
  it("tells Xcode's build to wait for pod install when the pod's files changed since", () => {
    const native = nativePackage();

    // Before pod install has recorded anything, nothing is known.
    expect(podInstallStale(native, [])).toBeUndefined();

    fs.writeFileSync(path.join(native, POD_INSTALL_RECORD), `${podSourcesDigest(native)}\n`);
    expect(podInstallStale(native, [])).toBeUndefined();

    fs.writeFileSync(path.join(native, "cpp/generated/m_more.cpp"), "");
    const stale = podInstallStale(native, [
      { kind: "relink", targets: ["ios"], files: ["cpp/generated/m_more.cpp"] },
      { kind: "compile-native", targets: ["ios"], files: ["cpp/generated/m_one.cpp"] },
    ]);

    expect(stale).toContain("(cpp/generated/m_more.cpp)");
    expect(stale).toContain("run pod install in ios/, then build again");
  });

  it("writes problems as issues Xcode opens at their line", () => {
    const root = path.join(os.tmpdir(), "app");

    expect(
      xcodeIssue(root, {
        file: "src/a.lucent.ts",
        line: 3,
        column: 7,
        code: "LUCENT3004",
        message: "lucent:ios/Kit was not found",
      }),
    ).toBe(
      `${path.join(root, "src/a.lucent.ts")}:3:7: error: LUCENT3004: lucent:ios/Kit was not found`,
    );
    expect(xcodeIssue(root, { code: "LUCENT9002", message: "no file", severity: "warning" })).toBe(
      "warning: LUCENT9002: no file",
    );
  });
});

describe("a Lucent package's pod, for the build's notices", () => {
  const native = {
    ios: { pods: { LucentAuthKit: { "~> 1.0": ["lucent-auth"] } } },
  } as unknown as Parameters<typeof uninstalledPods>[0];
  const notFound = {
    code: "LUCENT3004",
    message: "lucent:ios/LucentAuthKit was not found in the SDK or the app's dependencies (…)",
  };

  it("is named while Podfile.lock lacks it, and once installed if its module isn't found", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lucent-pods-"));
    const lockfile = path.join(dir, "Podfile.lock");

    expect(uninstalledPods(native, {})).toEqual({
      subject: "lucent-auth's pod LucentAuthKit is not installed",
      them: "it",
    });
    expect(unboundPods(native, {}, [notFound])).toBeUndefined();

    fs.writeFileSync(lockfile, "PODS:\n  - LucentAuthKit (1.0.3)\n");
    const sdk = { ios: { lockfile } } as Parameters<typeof uninstalledPods>[1];

    expect(uninstalledPods(native, sdk)).toBeUndefined();
    expect(unboundPods(native, sdk, [])).toBeUndefined();
    expect(unboundPods(native, sdk, [notFound])?.text).toBe(
      "lucent-auth's pod LucentAuthKit is installed, and lucent:ios/LucentAuthKit still not found: a pod's module binds once the pod defines one (DEFINES_MODULE, modular headers, a prebuilt framework, or use_frameworks!)",
    );
  });
});
