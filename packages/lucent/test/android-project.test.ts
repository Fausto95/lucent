import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vite-plus/test";
import { sdkAvailable } from "@lucent-lang/compiler";
import { runLucent } from "./run-to-exit.ts";
import { runJar, runJavac } from "../../bindgen/test/jvm-tools.ts";

const javac = spawnSync("javac", ["-version"]).status === 0;
const android = sdkAvailable("android");
const ios = process.platform === "darwin" && sdkAvailable("ios");

/** A library the app's dependencies ship, not android.jar: Play services' tasks. */
const DEPENDENCY = "com.google.android.gms.tasks";

/** A shared module whose Android branch runs `use`, with `imports`, and uses android.jar. */
function shared(imports: string, use: string): string {
  return `import { PLATFORM } from "lucent:platform";
import { Build } from "lucent:android/android.os";
${imports}

export function model(): string {
  if (PLATFORM === "android") {
    ${use}
    return Build.MODEL ?? "";
  }

  return "ios";
}
`;
}

/** An app with `files`, and no Android project: an Expo app before expo prebuild. */
function app(files: Record<string, string>): {
  root: string;
  lucent: (args: string[], env?: Record<string, string>) => { status: number | null; out: string };
} {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "lucent-android-project-")));

  fs.writeFileSync(path.join(root, "package.json"), JSON.stringify({ name: "app" }));
  for (const [name, text] of Object.entries(files)) fs.writeFileSync(path.join(root, name), text);

  const lucent = (args: string[], env: Record<string, string> = {}) => {
    const r = runLucent([...args, "--root", root], {
      // The shared SDK cache, as an app's builds use it: android.jar's modules are extracted once.
      env: { ...process.env, NO_COLOR: "1", ...env },
    });
    return { status: r.status, out: r.stdout + r.stderr };
  };

  return { root, lucent };
}

/** The app's Android project, with the classpath its Gradle build resolved: `jar`. */
function withAndroidProject(root: string, jar: string): void {
  fs.mkdirSync(path.join(root, "android"));
  fs.writeFileSync(path.join(root, "android/gradlew"), "#!/bin/sh\nexit 1\n", { mode: 0o755 });
  fs.mkdirSync(path.join(root, ".lucent"), { recursive: true });
  fs.writeFileSync(
    path.join(root, ".lucent/android-classpath.json"),
    JSON.stringify({ jars: [jar], aars: [] }),
  );
}

/** A jar declaring dev.orbit.tracking.Tracker, as a dependency's would. */
function trackerJar(root: string): string {
  const dir = path.join(root, "libs");
  const source = path.join(dir, "src/dev/orbit/tracking/Tracker.java");

  fs.mkdirSync(path.dirname(source), { recursive: true });
  fs.writeFileSync(
    source,
    'package dev.orbit.tracking;\npublic class Tracker {\n  public Tracker() {}\n  public String name() { return ""; }\n}\n',
  );
  runJavac(["--release", "11", "-d", path.join(dir, "classes"), source]);
  runJar(["cf", path.join(dir, "tracker.jar"), "-C", path.join(dir, "classes"), "."]);

  return path.join(dir, "tracker.jar");
}

describe.skipIf(!android)("an app without its Android project", () => {
  const pending = shared(
    `import { Tasks } from "lucent:android/${DEPENDENCY}";`,
    'Tasks.forResult("done");',
  );

  it("leaves its dependencies' modules untyped, named in a warning, where platform code has stubs", () => {
    const a = app({ "m.lucent.ts": pending });

    const r = a.lucent(["build", "--platforms", "host"]);
    expect(r.status, r.out).toBe(0);
    expect(r.out).toContain(`lucent:android/${DEPENDENCY}`);
    expect(r.out).toMatch(/expo prebuild/);
    expect(r.out).not.toMatch(/LUCENT3004/);
  });

  it.skipIf(!ios)("checks and builds iOS, and leaves Android to after expo prebuild", () => {
    const a = app({ "m.lucent.ts": pending });

    const check = a.lucent(["check"]);
    expect(check.status, check.out).toBe(0);
    expect(check.out).toContain(`lucent:android/${DEPENDENCY}`);

    const build = a.lucent(["build"]);
    expect(build.status, build.out).toBe(0);
    expect(build.out).toMatch(/skipped Android/);
    expect(fs.existsSync(path.join(a.root, ".lucent/native/cpp/generated/ios"))).toBe(true);
  });

  it("says why nothing is built where iOS's SDK is missing too", () => {
    const a = app({ "m.lucent.ts": pending });

    const r = a.lucent(["build"], { LUCENT_XCRUN: path.join(a.root, "no-xcrun") });
    expect(r.status).toBe(1);
    expect(r.out).toMatch(/no platform to build here: .*android: the app has no Android project/s);
  });

  it("still types code that uses android.jar only", () => {
    const a = app({ "m.lucent.ts": shared("", "Build.NOPE;") });

    const r = a.lucent(["build", "--platforms", "host"]);
    expect(r.status).toBe(1);
    expect(r.out).toMatch(/Property 'NOPE' does not exist/);
    expect(r.out).not.toMatch(/expo prebuild/);
  });
});

describe.skipIf(!android || !javac)("an app with its Android project", () => {
  const tracked = (use: string) =>
    shared('import { Tracker } from "lucent:android/dev.orbit.tracking";', use);

  it("types its dependencies' modules from the classpath its Gradle build resolved", () => {
    const a = app({ "m.lucent.ts": tracked("new Tracker().nope();") });
    withAndroidProject(a.root, trackerJar(a.root));

    const wrong = a.lucent(["build", "--platforms", "host"]);
    expect(wrong.status).toBe(1);
    expect(wrong.out).toMatch(/Property 'nope' does not exist on type 'Tracker'/);

    fs.writeFileSync(path.join(a.root, "m.lucent.ts"), tracked("new Tracker().name();"));
    const right = a.lucent(["build", "--platforms", "host"]);
    expect(right.status, right.out).toBe(0);
    expect(right.out).not.toMatch(/expo prebuild/);
  });
});
