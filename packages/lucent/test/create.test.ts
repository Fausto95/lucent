/**
 * Every template `lucent create` and `lucent new module` scaffold compiles
 * as it is written: each is created in a temporary directory, linked to
 * this repository's node_modules (no install), and built for the host and
 * checked, without platform SDKs, as on a Linux CI runner.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vite-plus/test";
import { runLucent } from "./run-to-exit.ts";

const repo = path.resolve(import.meta.dirname, "../../..");
const NO_SDKS = {
  ANDROID_HOME: path.join(os.tmpdir(), "lucent-no-android-sdk"),
  ANDROID_SDK_ROOT: "",
  LUCENT_XCRUN: path.join(os.tmpdir(), "lucent-no-xcrun"),
  NO_COLOR: "1",
};

function lucent(cwd: string, ...args: string[]) {
  const r = runLucent(args, { cwd, env: { ...process.env, ...NO_SDKS } });
  return { status: r.status, out: r.stdout + r.stderr, stdout: r.stdout };
}

/** Builds for the host and checks the project at `root`, expecting no problem. */
function compiles(root: string): void {
  // What npm install would give it: Lucent's and React Native's packages.
  if (!fs.existsSync(path.join(root, "node_modules")))
    fs.symlinkSync(path.join(repo, "node_modules"), path.join(root, "node_modules"));
  const build = lucent(root, "build", "--platforms", "host", "--root", root);
  expect(build.status, build.out).toBe(0);
  const check = lucent(root, "check", "--root", root);
  expect(check.status, check.out).toBe(0);
}

const tmp = () => fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "lucent-create-")));

describe("lucent create", () => {
  for (const template of ["expo", "bare", "view", "library", "module"])
    it(`scaffolds a ${template} project that builds and checks`, () => {
      const at = tmp();
      const r = lucent(
        at,
        "create",
        `my-${template}`,
        "--template",
        template,
        "--skip-install",
        "--json",
      );
      expect(r.status, r.out).toBe(0);
      const created = JSON.parse(r.stdout) as {
        ok: boolean;
        dir: string;
        files: string[];
        next: string[];
      };
      expect(created.ok).toBe(true);
      expect(created.dir).toBe(path.join(at, `my-${template}`));
      for (const f of created.files) expect(fs.existsSync(path.join(created.dir, f)), f).toBe(true);

      compiles(created.dir);
    }, 120_000);

  it("scaffolds a library whose example app builds it, as an app installing it does", () => {
    const at = tmp();
    expect(
      lucent(at, "create", "my-library", "--template", "library", "--skip-install").status,
    ).toBe(0);
    const dir = path.join(at, "my-library");
    const example = path.join(dir, "example");
    fs.mkdirSync(path.join(example, "node_modules"));
    for (const dep of fs.readdirSync(path.join(repo, "node_modules")))
      fs.symlinkSync(path.join(repo, "node_modules", dep), path.join(example, "node_modules", dep));
    fs.symlinkSync(dir, path.join(example, "node_modules", "my-library"));

    const build = lucent(example, "build", "--platforms", "host", "--root", example);
    expect(build.status, build.out).toBe(0);
    expect(build.out).toMatch(/my-library\/device/);
  }, 120_000);

  it("sets the apps up as lucent init does, and names the bare app's native projects", () => {
    const at = tmp();
    expect(lucent(at, "create", "cool-app", "--template", "bare", "--skip-install").status).toBe(0);
    const dir = path.join(at, "cool-app");
    for (const f of [
      "ios/CoolApp.xcodeproj/project.pbxproj",
      "ios/Podfile",
      "android/gradlew",
      ".gitignore",
    ])
      expect(fs.existsSync(path.join(dir, f)), f).toBe(true);
    expect(fs.readFileSync(path.join(dir, "react-native.config.js"), "utf8")).toContain(
      "@lucent-lang/lucent/autolink",
    );
    expect(fs.readFileSync(path.join(dir, "android/app/build.gradle"), "utf8")).toContain(
      "gradle/lucent.gradle",
    );
    expect(fs.readFileSync(path.join(dir, "metro.config.js"), "utf8")).toContain("withLucent(");
    expect(JSON.parse(fs.readFileSync(path.join(dir, "app.json"), "utf8")).name).toBe("CoolApp");
    expect(fs.statSync(path.join(dir, "android/gradlew")).mode & 0o111).not.toBe(0);
  });

  it("refuses an unknown template and a directory that isn't empty, writing nothing", () => {
    const at = tmp();
    const unknown = lucent(at, "create", "x", "--template", "nope", "--json");
    expect(unknown.status).toBe(2);
    expect(JSON.parse(unknown.stdout)).toMatchObject({
      ok: false,
      error: expect.stringMatching(/expo, bare/),
    });
    expect(fs.existsSync(path.join(at, "x"))).toBe(false);

    fs.mkdirSync(path.join(at, "taken"));
    fs.writeFileSync(path.join(at, "taken/file"), "");
    const taken = lucent(at, "create", "taken", "--yes", "--skip-install");
    expect(taken.status).toBe(1);
    expect(taken.out).toMatch(/isn't empty; nothing was written/);
  });
});

describe("lucent new module --template", () => {
  for (const template of ["function", "async", "events", "view", "sdk-ios-android"])
    it(`adds a ${template} module that builds and checks`, () => {
      const root = tmp();
      fs.writeFileSync(path.join(root, "package.json"), JSON.stringify({ name: "app" }));
      const r = lucent(
        root,
        "new",
        "module",
        "starter",
        "--template",
        template,
        "--root",
        root,
        "--json",
      );
      expect(r.status, r.out).toBe(0);
      const { files, import: use } = JSON.parse(r.stdout) as { files: string[]; import: string };
      expect(files.length).toBe(1);
      expect(use).toMatch(/from "\.\/src\/starter\.lucent"/);
      compiles(root);
    }, 120_000);

  it("refuses an unknown template", () => {
    const root = tmp();
    const r = lucent(root, "new", "module", "x", "--template", "nope", "--root", root);
    expect(r.status).toBe(2);
    expect(r.out).toMatch(/function, async, events, view, sdk-ios-android/);
  });
});
