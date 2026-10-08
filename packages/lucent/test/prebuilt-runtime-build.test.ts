/**
 * scripts/prebuilt-runtime.ts's host target, built and used as an app's
 * native build uses an ABI's: the runtime's unit tests link the prebuilt
 * core and compile only the sources it leaves out, and pass.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vite-plus/test";
import { prebuiltCoreSources } from "../../compiler/src/prebuilt-runtime.ts";

const repo = path.resolve(import.meta.dirname, "../../..");
const cpp = path.join(repo, "packages/runtime/cpp");
const tools = ["cmake", "ninja", "clang++"].every((t) => spawnSync(t, ["--version"]).status === 0);

describe.skipIf(!tools)("the prebuilt runtime's host build", () => {
  it("links with the sources it leaves out, and the runtime's tests pass", () => {
    const out = fs.mkdtempSync(path.join(os.tmpdir(), "lucent-prebuilt-host-"));
    const built = spawnSync(
      process.execPath,
      [path.join(repo, "scripts/prebuilt-runtime.ts"), "host"],
      {
        env: { ...process.env, LUCENT_PREBUILT_OUT: out },
        encoding: "utf8",
      },
    );
    expect(built.status, built.stdout + built.stderr).toBe(0);
    const manifest = JSON.parse(fs.readFileSync(path.join(out, "manifest.json"), "utf8")) as {
      core: string[];
      targets: Record<string, { artifact: string }>;
    };
    expect(manifest.core).toEqual(prebuiltCoreSources(cpp));
    const lib = path.join(out, manifest.targets.host!.artifact);

    // What the native package still compiles: the runtime's sources the core leaves out
    // that build on a host (JSI's need React Native's headers).
    const rest = fs
      .readdirSync(path.join(cpp, "lucent"))
      .filter((f) => f.endsWith(".cpp") && !manifest.core.includes(`lucent/${f}`))
      .map((f) => path.join(cpp, "lucent", f));
    const flags = ["-std=c++20", "-ffp-contract=off", "-O1", `-I${cpp}`];
    const test = path.join(out, "runtime_test");
    const linked = spawnSync(
      "clang++",
      [
        ...flags,
        path.join(repo, "packages/runtime/test/runtime_test.cpp"),
        ...rest,
        lib,
        "-lpthread",
        "-o",
        test,
      ],
      { encoding: "utf8" },
    );
    expect(linked.status, linked.stderr).toBe(0);
    const ran = spawnSync(test, { encoding: "utf8" });
    expect(ran.status, ran.stderr).toBe(0);
    expect(ran.stdout + ran.stderr).toMatch(/\d+ checks, 0 failures/);
  }, 600_000);
});
