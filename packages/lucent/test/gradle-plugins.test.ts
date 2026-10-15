import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vite-plus/test";
import type { ResolvedNative } from "@lucent-lang/compiler";
import { missingGradlePlugins } from "../src/cli/project.ts";

/*
 * The Gradle plugins Lucent packages need (lucent.json's
 * android.gradlePlugins): lucent build names what a bare app's build files
 * lack, as it names Info.plist entries, since the build files are the app's.
 */

const SERVICES = "com.google.gms.google-services";

function bareApp(files: Record<string, string>): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "lucent-gradle-plugins-"));
  for (const [name, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, "android", name)), { recursive: true });
    fs.writeFileSync(path.join(root, "android", name), text);
  }
  return root;
}

const needs = (from = ["lucent-push"]) =>
  ({
    android: {
      gradlePlugins: { [SERVICES]: { value: "com.google.gms:google-services:4.4.2", from } },
    },
  }) as unknown as ResolvedNative;

const PROJECT = `buildscript {
  dependencies {
    classpath("com.android.tools.build:gradle")
  }
}
`;

describe("the Gradle plugins a bare app's build lacks", () => {
  it("names the classpath artifact and the plugin, with the line that adds each", () => {
    const root = bareApp({
      "build.gradle": PROJECT,
      "app/build.gradle": 'apply plugin: "com.android.application"\n',
    });
    expect(missingGradlePlugins(root, needs()).map((n) => n.text)).toEqual([
      `lucent-push needs com.google.gms:google-services:4.4.2 on the buildscript classpath in ${path.join("android", "build.gradle")}: classpath("com.google.gms:google-services:4.4.2") (the Expo config plugin adds it)`,
      `lucent-push needs the Gradle plugin ${SERVICES} applied in ${path.join("android", "app", "build.gradle")}: apply plugin: "${SERVICES}" (the Expo config plugin adds it)`,
    ]);

    const kotlin = bareApp({
      "build.gradle.kts": PROJECT.replace(
        'gradle")',
        `gradle")\n    classpath("com.google.gms:google-services:4.3.0")`,
      ),
      "app/build.gradle.kts": 'plugins {\n  id("com.android.application")\n}\n',
    });
    expect(missingGradlePlugins(kotlin, needs(["a", "b"])).map((n) => n.text)).toEqual([
      `a and b need the Gradle plugin ${SERVICES} applied in ${path.join("android", "app", "build.gradle.kts")}: apply(plugin = "${SERVICES}") (the Expo config plugin adds it)`,
    ]);
  });

  it("says nothing when the build has them, in any of the ways it can", () => {
    const applied = bareApp({
      "build.gradle": PROJECT.replace(
        'gradle")',
        `gradle")\n    classpath 'com.google.gms:google-services:4.4.1'`,
      ),
      "app/build.gradle": `apply plugin: "com.android.application"\napply plugin: '${SERVICES}'\n`,
    });
    expect(missingGradlePlugins(applied, needs())).toEqual([]);

    // The plugins block, with its version in settings.gradle.
    const declared = bareApp({
      "build.gradle": "",
      "settings.gradle": `plugins {\n  id "${SERVICES}" version "4.4.2" apply false\n}\n`,
      "app/build.gradle": `plugins {\n  id "com.android.application"\n  id "${SERVICES}"\n}\n`,
    });
    expect(missingGradlePlugins(declared, needs())).toEqual([]);

    // The version catalog's alias.
    const catalog = bareApp({
      "build.gradle.kts": "",
      "gradle/libs.versions.toml": `[versions]\nagp = "8.6.0"\n\n[plugins]\ngoogle-services = { id = "${SERVICES}", version = "4.4.2" }\n`,
      "app/build.gradle.kts": "plugins {\n  alias(libs.plugins.google.services)\n}\n",
    });
    expect(missingGradlePlugins(catalog, needs())).toEqual([]);
  });

  it("says nothing without an Android project, or when no package asks", () => {
    expect(missingGradlePlugins(bareApp({}), needs())).toEqual([]);
    const root = bareApp({ "build.gradle": PROJECT, "app/build.gradle": "" });
    expect(missingGradlePlugins(root, { android: {} } as ResolvedNative)).toEqual([]);
  });
});
