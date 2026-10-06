import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { resolveNative } from "@lucent-lang/compiler";
import { describe, expect, it } from "vite-plus/test";
import { writeLinkedPackage } from "../src/cli/project.ts";

/** The native inputs of one Lucent package whose lucent.json is `native`. */
function packageNative(name: string, native: unknown) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lucent-pkg-"));
  fs.writeFileSync(path.join(dir, "lucent.json"), JSON.stringify(native));

  return resolveNative([{ name, version: "1.0.0", dir, sources: path.join(dir, "src") }]);
}

/** A native package as the last build left it: `java` its Android library's generated Kotlin. */
function lastBuild(java: Record<string, string>): { root: string; out: string } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "lucent-linked-"));
  const out = path.join(root, ".lucent/native");

  for (const [file, text] of Object.entries(java)) {
    const to = path.join(out, "android/src/main/java", file);

    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.writeFileSync(to, text);
  }

  return { root, out };
}

const gradle = (out: string) => fs.readFileSync(path.join(out, "android/build.gradle"), "utf8");

describe("the linked native package, before a build writes the rest", () => {
  it("keeps the Compose compiler for the Compose content the last build wrote", () => {
    const { root, out } = lastBuild({ "dev/lucent/compose/LucentToggle_0.kt": "// content\n" });

    writeLinkedPackage(root, out, resolveNative([]), { android: true });

    expect(gradle(out)).toContain('apply plugin: "org.jetbrains.kotlin.plugin.compose"');
    expect(gradle(out)).toContain('implementation(platform("androidx.compose:compose-bom:');

    fs.rmSync(root, { recursive: true, force: true });
  });

  it("leaves Compose out without Compose content", () => {
    const { root, out } = lastBuild({ "dev/lucent/shims/LucentShims_x.kt": "// shims\n" });

    writeLinkedPackage(root, out, resolveNative([]), { android: true });

    expect(gradle(out)).toContain('apply plugin: "org.jetbrains.kotlin.android"');
    expect(gradle(out)).not.toContain("compose");

    fs.rmSync(root, { recursive: true, force: true });
  });

  it("depends on the packages' pods, so pod install brings them before the first build binds them", () => {
    const { root, out } = lastBuild({});
    const native = packageNative("lucent-auth", { ios: { pods: { LucentAuthKit: "~> 1.0" } } });

    writeLinkedPackage(root, out, native, { ios: true });

    expect(fs.readFileSync(path.join(out, "LucentNative.podspec"), "utf8")).toContain(
      's.dependency "LucentAuthKit", "~> 1.0"',
    );
    expect(fs.existsSync(path.join(out, "react-native.config.js"))).toBe(true);

    fs.rmSync(root, { recursive: true, force: true });
  });

  it("starts the podspec again from the template when an edit took its closing end", () => {
    const { root, out } = lastBuild({});
    const one = packageNative("lucent-auth", { ios: { pods: { LucentAuthKit: "~> 1.0" } } });
    const two = packageNative("lucent-auth", {
      ios: { pods: { LucentAuthKit: "~> 1.0", OtherKit: "1.0" } },
    });
    writeLinkedPackage(root, out, one, { ios: true });
    const file = path.join(out, "LucentNative.podspec");
    fs.writeFileSync(file, fs.readFileSync(file, "utf8").replace(/^end\s*$/m, ""));

    writeLinkedPackage(root, out, two, { ios: true });

    const fresh = lastBuild({});
    writeLinkedPackage(fresh.root, fresh.out, two, { ios: true });
    expect(fs.readFileSync(file, "utf8")).toBe(
      fs.readFileSync(path.join(fresh.out, "LucentNative.podspec"), "utf8"),
    );

    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(fresh.root, { recursive: true, force: true });
  });
});
