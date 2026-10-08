import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vite-plus/test";
import {
  prebuiltCoreSources,
  prebuiltRuntimeFiles,
  runtimeSourcesHash,
} from "../src/prebuilt-runtime.ts";
import { runtimeDir } from "../src/native-package.ts";

const runtime = runtimeDir();
const cpp = path.join(runtime, "cpp");

/** A copy of the runtime with a prebuilt/ of fake artifacts, built from `hash`. */
function withPrebuilt(hash = runtimeSourcesHash(cpp)): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lucent-prebuilt-"));
  for (const sub of ["cpp", "native", "js"])
    fs.cpSync(path.join(runtime, sub), path.join(dir, sub), { recursive: true });
  fs.mkdirSync(path.join(dir, "prebuilt/android/arm64-v8a"), { recursive: true });
  fs.writeFileSync(path.join(dir, "prebuilt/android/arm64-v8a/liblucentcore.a"), "!<arch>\n");
  fs.writeFileSync(
    path.join(dir, "prebuilt/manifest.json"),
    JSON.stringify({
      sourcesHash: hash,
      core: prebuiltCoreSources(cpp),
      targets: { "android/arm64-v8a": { artifact: "android/arm64-v8a/liblucentcore.a" } },
    }),
  );
  return dir;
}

describe("the prebuilt runtime", () => {
  it("is the runtime's sources that reach no JSI, React Native or fbjni header", () => {
    const core = prebuiltCoreSources(cpp);
    expect(core).toContain("lucent/bigint.cpp");
    expect(core).toContain("third_party/quickjs/libregexp.c");
    // JSI's (the app's React Native decides its ABI), and fbjni's on Android.
    expect(core).not.toContain("lucent/jsi/host.cpp");
    expect(core).not.toContain("lucent/jsstring.cpp");
    expect(core.some((f) => f.startsWith("rn/") || f.includes("/platform/"))).toBe(false);
  });

  it("goes into the native package only when built from this runtime's sources", () => {
    const files = prebuiltRuntimeFiles(withPrebuilt());
    expect([...files.keys()].sort()).toEqual([
      "android/arm64-v8a/liblucentcore.a",
      "core-sources.txt",
      "manifest.json",
    ]);
    expect(files.get("core-sources.txt")!.toString()).toContain("cpp/lucent/bigint.cpp\n");

    expect(prebuiltRuntimeFiles(withPrebuilt("0000000000000000")).size).toBe(0);
    expect(prebuiltRuntimeFiles(withPrebuilt(), { LUCENT_RUNTIME_FROM_SOURCE: "1" }).size).toBe(0);
  });

  it.skipIf(spawnSync("ruby", ["--version"]).status !== 0)("keeps the podspec valid Ruby", () => {
    expect(
      spawnSync("ruby", ["-c", path.join(runtime, "native/LucentNative.podspec")]).status,
    ).toBe(0);
  });

  it("is what the native package's podspec and CMake link instead of those sources", () => {
    const podspec = fs.readFileSync(path.join(runtime, "native/LucentNative.podspec"), "utf8");
    expect(podspec).toMatch(/prebuilt", "ios", "LucentCore\.xcframework"/);
    expect(podspec).toMatch(/core-sources\.txt/);

    const cmake = fs.readFileSync(path.join(runtime, "native/android/CMakeLists.txt"), "utf8");
    expect(cmake).toMatch(/prebuilt\/android\/\$\{ANDROID_ABI\}\/liblucentcore\.a/);
    expect(cmake).toMatch(/LUCENT_RUNTIME_FROM_SOURCE/);
  });
});
