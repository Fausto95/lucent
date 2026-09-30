import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vite-plus/test";
import { resolveNative } from "@lucent-lang/compiler";
import { projectSdk, resolveAndroidDependencies } from "../src/cli/project.ts";

/**
 * An app with a module importing an Android library, and a stand-in
 * gradlew that records each launch (and what lucent build tells it) and
 * writes the classpath.
 */
function app(): { root: string; file: string; launches: () => string[] } {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "lucent-gradle-runs-")));
  const file = path.join(root, "a.lucent.ts");
  const calls = path.join(root, "gradlew-calls");

  fs.writeFileSync(file, 'import { ContextCompat } from "lucent:android/androidx.core.content";\n');
  fs.mkdirSync(path.join(root, "android"));
  fs.writeFileSync(path.join(root, "android/build.gradle"), "// the app's\n");
  fs.writeFileSync(
    path.join(root, "android/gradlew"),
    `#!/bin/sh
echo "launch LUCENT_GRADLE_CLASSPATH=$LUCENT_GRADLE_CLASSPATH" >> ${JSON.stringify(calls)}
mkdir -p ../.lucent
echo '{"aars":[],"jars":[]}' > ../.lucent/android-classpath.json
`,
    { mode: 0o755 },
  );

  return {
    root,
    file,
    launches: () => (fs.existsSync(calls) ? fs.readFileSync(calls, "utf8").trim().split("\n") : []),
  };
}

const native = resolveNative([]).manifest;

function resolve(root: string, file: string, env: Record<string, string> = {}) {
  const saved = { ...process.env };
  Object.assign(process.env, env);

  try {
    return resolveAndroidDependencies(root, [file], projectSdk(root), native, false);
  } finally {
    for (const key of Object.keys(env)) delete process.env[key];
    Object.assign(process.env, saved);
  }
}

describe("resolving the app's Android dependencies with Gradle", () => {
  it("tells the Gradle it launches that it runs for lucent build, so it never launches another", () => {
    const { root, file, launches } = app();

    expect(resolve(root, file).status).toBe("resolved");
    expect(launches()).toEqual(["launch LUCENT_GRADLE_CLASSPATH=1"]);
  });

  it("reuses what the Gradle build it runs in resolved, instead of launching Gradle later", () => {
    const { root, file, launches } = app();
    fs.mkdirSync(path.join(root, ".lucent"));
    fs.writeFileSync(path.join(root, ".lucent/android-classpath.json"), '{"aars":[],"jars":[]}');

    // lucent build from the app's Gradle build (its lucentBuild task).
    expect(resolve(root, file, { LUCENT_GRADLE_CLASSPATH: "1" }).status).toBe("cached");

    // Then on its own, with the same build files.
    expect(resolve(root, file).status).toBe("cached");
    expect(launches()).toEqual([]);
  });

  it("waits for a Gradle run another lucent build started, and uses what it resolved", async () => {
    const { root, file, launches } = app();
    const lucentDir = path.join(root, ".lucent");
    const classpath = path.join(lucentDir, "android-classpath.json");
    const state = path.join(lucentDir, "android-classpath.state.json");

    // A first resolution records the inputs Gradle resolved for.
    expect(resolve(root, file).status).toBe("resolved");
    const resolved = fs.readFileSync(state, "utf8");
    fs.rmSync(classpath);
    fs.rmSync(state);

    // Another lucent build holds the lock while its Gradle runs, then records its outcome and unlocks.
    const lock = path.join(lucentDir, "gradle.lock");
    const other = spawn(
      process.execPath,
      [
        "-e",
        `
const fs = require("node:fs");
fs.writeFileSync(${JSON.stringify(lock)}, require("node:os").hostname() + "\\n" + process.pid);
setTimeout(() => {
  fs.writeFileSync(${JSON.stringify(classpath)}, '{"aars":[],"jars":[]}');
  fs.writeFileSync(${JSON.stringify(state)}, ${JSON.stringify(resolved)});
  fs.rmSync(${JSON.stringify(lock)});
}, 800);
`,
      ],
      { stdio: "inherit" },
    );
    const exited = new Promise((r) => other.on("exit", r));

    while (!fs.existsSync(lock)) await new Promise((r) => setTimeout(r, 20));

    // Waits for the lock, then finds the classpath resolved for the same inputs.
    expect(resolve(root, file).status).toBe("cached");
    expect(launches()).toHaveLength(1);

    await exited;
  }, 30_000);
});
