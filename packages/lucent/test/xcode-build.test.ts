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
