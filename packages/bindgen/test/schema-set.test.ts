/**
 * The exported schema set (lucent-sdk.schemas/): what a machine with a
 * platform's SDK read, served where that SDK is missing.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vite-plus/test";
import {
  cachedModules,
  exportSchemaSet,
  forgetLoadedSdks,
  sdkAvailable,
  sdkFromSchemaSet,
  sdkIdentity,
  sdkModule,
  sdkModuleArtifacts,
  sdkModules,
} from "../src/provider.ts";
import { runJar, runJavac } from "./jvm-tools.ts";

const fixtures = path.join(import.meta.dirname, "fixtures");
const javac =
  spawnSync("javac", ["-version"]).status === 0 && spawnSync("jar", ["--version"]).status === 0;

function fixtureJar(dir: string): string {
  const sources = spawnSync("find", [path.join(fixtures, "java"), "-name", "*.java"], {
    encoding: "utf8",
  })
    .stdout.trim()
    .split("\n");
  const classes = path.join(dir, "classes");
  const cc = runJavac(["--release", "11", "-d", classes, ...sources]);
  if (cc.status !== 0) throw new Error(cc.stderr);
  const jar = path.join(dir, "fixture.jar");
  runJar(["cf", jar, "-C", classes, "."]);
  return jar;
}

describe.skipIf(!javac)("the exported schema set", () => {
  it("serves what a machine with the SDK read where the SDK is missing", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lucent-set-"));
    const jar = fixtureJar(dir);
    const set = path.join(dir, "lucent-sdk.schemas");
    const withSdk = { cacheDir: path.join(dir, "cache"), android: { jars: [jar] } };

    const read = sdkModule("android", "com.example.widgets", withSdk);
    if (!("schema" in read)) throw new Error(read.missing);
    const written = exportSchemaSet(set, ["android"], withSdk);
    const artifacts = sdkModuleArtifacts("android", "com.example.widgets", withSdk);

    // The widgets package, and the packages its schema names (com.example.base's Shape).
    expect(written.map((f) => path.relative(set, f))).toEqual(
      expect.arrayContaining([
        path.join("android", "com.example.widgets.json"),
        path.join("android", "com.example.base.json"),
      ]),
    );

    // A teammate without the SDK: another process, another cache, no jar.
    forgetLoadedSdks();
    const without = {
      cacheDir: path.join(dir, "other-cache"),
      schemas: set,
      android: { jars: [path.join(dir, "no-such.jar")] },
    };

    expect(sdkAvailable("android", without)).toBe(true);
    expect(sdkFromSchemaSet("android", without)).toBe(true);
    expect(sdkModule("android", "com.example.widgets", without)).toEqual(read);
    expect(sdkModuleArtifacts("android", "com.example.widgets", without).map((a) => a.id)).toEqual(
      artifacts.map((a) => a.id),
    );
    expect(sdkModules("android", without)).toEqual(
      expect.arrayContaining(["com.example.base", "com.example.widgets"]),
    );
    expect(cachedModules("android", without)).toMatchObject({
      schemas: expect.arrayContaining(["com.example.widgets"]),
    });
    expect(sdkIdentity(without)).toMatch(/\|set-/);

    const absent = sdkModule("android", "com.example.tasks", without);
    expect(absent).toMatchObject({
      missing: expect.stringMatching(/not in the exported schemas/),
      fix: expect.stringMatching(/lucent sdk lock --schemas/),
    });
  });

  it("is not read where the SDK is installed", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lucent-set-"));
    const jar = fixtureJar(dir);
    const set = path.join(dir, "lucent-sdk.schemas");
    fs.mkdirSync(path.join(set, "android"), { recursive: true });
    fs.writeFileSync(path.join(set, "android/com.example.widgets.json"), "{}");

    forgetLoadedSdks();
    const opts = { cacheDir: path.join(dir, "cache"), schemas: set, android: { jars: [jar] } };

    expect(sdkFromSchemaSet("android", opts)).toBe(false);
    expect("schema" in sdkModule("android", "com.example.widgets", opts)).toBe(true);
  });
});
