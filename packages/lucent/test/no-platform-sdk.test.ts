/**
 * Builds and checks on a machine without the platforms' SDKs: Linux CI, and
 * EAS's Android builders, where `expo prebuild` runs lucent build with no
 * iOS SDK and Android's dependencies left to the Gradle build.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vite-plus/test";
import { runLucent } from "./run-to-exit.ts";

/** No platform SDK, wherever the tests run: a Mac is told Xcode and the Android SDK are elsewhere. */
const NO_SDKS = {
  ANDROID_HOME: path.join(os.tmpdir(), "lucent-no-android-sdk"),
  ANDROID_SDK_ROOT: "",
  LUCENT_XCRUN: path.join(os.tmpdir(), "lucent-no-xcrun"),
};

/** A shared module with an Android branch that calls the SDK, and `extra` code. */
const shared = (extra = "") => `import { PLATFORM } from "lucent:platform";
import { Build } from "lucent:android/android.os";

export function model(): string {
  if (PLATFORM === "android") return Build.MODEL ?? "";
  return "ios";
}
${extra}`;

const WRONG = 'export function bad(): number { const n: number = "s"; return n; }\n';

function app(source: string, androidProject = false) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "lucent-no-sdk-")));

  fs.writeFileSync(path.join(root, "package.json"), JSON.stringify({ name: "app" }));
  fs.writeFileSync(path.join(root, "m.lucent.ts"), source);
  if (androidProject) {
    // As expo prebuild leaves it: android/gradlew written, the Gradle build not run yet.
    fs.mkdirSync(path.join(root, "android"));
    fs.writeFileSync(path.join(root, "android/gradlew"), "#!/bin/sh\nexit 1\n", { mode: 0o755 });
  }

  const lucent = (args: string[], env: Record<string, string> = {}) => {
    const r = runLucent([...args, "--root", root], {
      env: { ...process.env, NO_COLOR: "1", ...NO_SDKS, ...env },
    });
    return { status: r.status, out: r.stdout + r.stderr };
  };

  return { root, lucent };
}

describe("expo prebuild without iOS's SDK", () => {
  for (const args of [[], ["--platforms", "android"]])
    it(`writes the linked package and leaves Android to the Gradle build (${args.join(" ") || "no --platforms"})`, () => {
      const a = app(shared(), true);

      const r = a.lucent(["build", ...args], { LUCENT_NO_GRADLE: "1" });
      expect(r.status, r.out).toBe(0);
      expect(r.out).toMatch(/the Gradle build/);
      // What autolinking reads, the library the Gradle build compiles Android in, the proxy.
      for (const f of ["react-native.config.js", "android/build.gradle", "js/m.js"])
        expect(fs.existsSync(path.join(a.root, ".lucent/native", f)), f).toBe(true);
    });

  it("still fails on the shared code's errors", () => {
    const a = app(shared(WRONG), true);

    const r = a.lucent(["build"], { LUCENT_NO_GRADLE: "1" });
    expect(r.status).toBe(1);
    expect(r.out).toMatch(/Type 'string' is not assignable to type 'number'/);
  });
});

describe("lucent check without any platform SDK (CI)", () => {
  it("reports the code's problems, with the platforms' SDK imports untyped", () => {
    const a = app(shared(WRONG));

    const r = a.lucent(["check"]);
    expect(r.status).toBe(1);
    expect(r.out).toMatch(/Type 'string' is not assignable to type 'number'/);
  });

  it("passes code without problems", () => {
    const r = app(shared()).lucent(["check"]);
    expect(r.status, r.out).toBe(0);
  });

  it("takes --platforms host", () => {
    const a = app(shared(WRONG));

    const r = a.lucent(["check", "--platforms", "host"]);
    expect(r.status).toBe(1);
    expect(r.out).toMatch(/Type 'string' is not assignable to type 'number'/);
    expect(r.out).not.toMatch(/unknown flag/);
  });
});

describe("--platforms", () => {
  it("refuses a target that isn't one, and keeps what the last build wrote", () => {
    const a = app(shared());

    expect(a.lucent(["build", "--platforms", "host"]).status).toBe(0);
    const host = path.join(a.root, ".lucent/native/cpp/generated/host");
    expect(fs.existsSync(host)).toBe(true);

    for (const command of ["build", "check"]) {
      const r = a.lucent([command, "--platforms", "iso"]);
      expect(r.status).toBe(2);
      expect(r.out).toMatch(/--platforms takes ios, android, host .*not iso/);
    }
    expect(fs.existsSync(host)).toBe(true);
  });
});
