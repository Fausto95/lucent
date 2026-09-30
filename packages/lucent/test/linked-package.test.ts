import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { resolveNative } from "@lucent-lang/compiler";
import { describe, expect, it } from "vite-plus/test";
import { writeLinkedPackage } from "../src/cli/project.ts";

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

    writeLinkedPackage(root, out, resolveNative([]));

    expect(gradle(out)).toContain('apply plugin: "org.jetbrains.kotlin.plugin.compose"');
    expect(gradle(out)).toContain('implementation(platform("androidx.compose:compose-bom:');

    fs.rmSync(root, { recursive: true, force: true });
  });

  it("leaves Compose out without Compose content", () => {
    const { root, out } = lastBuild({ "dev/lucent/shims/LucentShims_x.kt": "// shims\n" });

    writeLinkedPackage(root, out, resolveNative([]));

    expect(gradle(out)).toContain('apply plugin: "org.jetbrains.kotlin.android"');
    expect(gradle(out)).not.toContain("compose");

    fs.rmSync(root, { recursive: true, force: true });
  });
});
