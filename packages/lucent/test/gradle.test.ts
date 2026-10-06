import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vite-plus/test";

const repo = path.resolve(import.meta.dirname, "../../..");
const gradleDir = path.resolve(import.meta.dirname, "../gradle");
// The bare example's Gradle wrapper, so the test needs no Gradle of its own.
const wrapper = path.join(repo, "apps/bare-example/android");

/** A JDK Gradle runs on: an LTS one Android builds use (macOS's java_home), else JAVA_HOME. */
function javaHome(): string | undefined {
  if (process.platform === "darwin") {
    for (const v of ["21", "17"]) {
      const r = spawnSync("/usr/libexec/java_home", ["-v", v], { encoding: "utf8" });
      if (r.status === 0) return r.stdout.trim();
    }
  }
  return process.env.JAVA_HOME && fs.existsSync(process.env.JAVA_HOME)
    ? process.env.JAVA_HOME
    : undefined;
}
const jdk = javaHome();

interface AppOptions {
  /**
   * The compile classpaths the stand-in Android plugin makes, as AGP names
   * its variants' (with product flavors, `freeDebugCompileClasspath`…).
   * Each depends on a library of a local repository named after its
   * variant (`freeDebug-1.0.jar`), so the classpath read is the one bound.
   */
  classpaths?: string[];
  /** The app's build script, relative to android/: app/build.gradle applying lucent.gradle by default. */
  build?: { file: string; text: string };
}

/**
 * An app as lucent init leaves it: android/app/build.gradle applies Lucent's
 * Gradle task. The Android plugin is a stand-in with its id that only makes
 * the configurations lucentClasspath reads, so Gradle runs without the SDK.
 */
function app({ classpaths = ["debugCompileClasspath"], build }: AppOptions = {}): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "lucent-gradle-"));
  const android = path.join(root, "android");
  const write = (rel: string, text: string) => {
    fs.mkdirSync(path.dirname(path.join(android, rel)), { recursive: true });
    fs.writeFileSync(path.join(android, rel), text);
  };
  fs.cpSync(path.join(wrapper, "gradlew"), path.join(android, "gradlew"));
  fs.cpSync(path.join(wrapper, "gradle/wrapper"), path.join(android, "gradle/wrapper"), {
    recursive: true,
  });
  write("settings.gradle", `rootProject.name = "app"\ninclude ":app"\n`);
  write("gradle.properties", `classpaths=${classpaths.join(",")}\n`);
  write(
    "buildSrc/build.gradle",
    `plugins { id "java-gradle-plugin" }
gradlePlugin { plugins { android { id = "com.android.application"; implementationClass = "FakeAndroidApp" } } }
`,
  );
  write(
    "buildSrc/src/main/java/FakeAndroidApp.java",
    `import org.gradle.api.Plugin;
import org.gradle.api.Project;

public class FakeAndroidApp implements Plugin<Project> {
  public void apply(Project project) {
    for (String name : project.property("classpaths").toString().split(","))
      project.getConfigurations().create(name);
  }
}
`,
  );

  // A Maven repository on disk, with a library per variant.
  for (const classpath of classpaths) {
    const variant = classpath.replace(/CompileClasspath$/, "");
    const dir = `repo/lucent/test/${variant}/1.0`;
    write(
      `${dir}/${variant}-1.0.pom`,
      `<project><modelVersion>4.0.0</modelVersion><groupId>lucent.test</groupId><artifactId>${variant}</artifactId><version>1.0</version></project>\n`,
    );
    fs.cpSync(
      path.join(wrapper, "gradle/wrapper/gradle-wrapper.jar"),
      path.join(android, `${dir}/${variant}-1.0.jar`),
    );
  }

  const { file, text } = build ?? {
    file: "app/build.gradle",
    text: `plugins { id "com.android.application" }
apply from: ${JSON.stringify(path.join(gradleDir, "lucent.gradle"))}
repositories { maven { url = uri("../repo") } }
configurations.matching { it.name.endsWith("CompileClasspath") }.all { c ->
  project.dependencies.add(c.name, "lucent.test:\${c.name - "CompileClasspath"}:1.0")
}
`,
  };
  write(file, text);
  return root;
}

const canRun = !!jdk && fs.existsSync(path.join(wrapper, "gradlew"));

/** Runs Gradle in the app, offline. */
function gradle(root: string, ...args: string[]) {
  const r = spawnSync(path.join(root, "android/gradlew"), ["-q", "--offline", ...args], {
    cwd: path.join(root, "android"),
    encoding: "utf8",
    env: { ...process.env, JAVA_HOME: jdk },
  });
  return { status: r.status, out: r.stderr + r.stdout };
}

/** lucentClasspath as lucent build runs it (resolveAndroidDependencies): through the init script. */
const lucentClasspath = (root: string) =>
  gradle(
    root,
    "--init-script",
    path.join(gradleDir, "lucent-classpath.init.gradle"),
    ":app:lucentClasspath",
  );

/** What lucentClasspath wrote: the bound libraries' file names. */
function bound(root: string): { aars: string[]; jars: string[] } {
  const { aars, jars } = JSON.parse(
    fs.readFileSync(path.join(root, ".lucent/android-classpath.json"), "utf8"),
  ) as { aars: string[]; jars: string[] };
  return { aars: aars.map((f) => path.basename(f)), jars: jars.map((f) => path.basename(f)) };
}

describe("Lucent's Gradle scripts", () => {
  it.skipIf(!canRun)(
    "resolve the classpath the way lucent build asks, in an app that applies Lucent's Gradle task",
    () => {
      const root = app();
      const r = lucentClasspath(root);
      expect(r.status, r.out).toBe(0);
      expect(bound(root)).toEqual({ aars: [], jars: ["debug-1.0.jar"] });
    },
    300_000,
  );

  it.skipIf(!canRun)(
    "bind a flavored app's first debug variant's classpath",
    () => {
      const root = app({
        // Not in name order, as a plugin may create them.
        classpaths: [
          "paidDebugCompileClasspath",
          "freeReleaseCompileClasspath",
          "freeDebugUnitTestCompileClasspath",
          "freeDebugCompileClasspath",
        ],
      });
      const r = lucentClasspath(root);
      expect(r.status, r.out).toBe(0);
      expect(bound(root)).toEqual({ aars: [], jars: ["freeDebug-1.0.jar"] });
    },
    300_000,
  );

  it.skipIf(!canRun)(
    "run lucentBuild's dependency in a flavored app",
    () => {
      const root = app({
        classpaths: ["freeDebugCompileClasspath", "freeReleaseCompileClasspath"],
      });
      const r = gradle(root, ":app:lucentBuild", "--dry-run");
      expect(r.status, r.out).toBe(0);
    },
    300_000,
  );

  it.skipIf(!canRun)(
    "fall back to the release variant's classpath when the debug variants are disabled",
    () => {
      for (const variant of ["release", "freeRelease"]) {
        const root = app({ classpaths: [`${variant}CompileClasspath`] });
        const r = lucentClasspath(root);
        expect(r.status, r.out).toBe(0);
        expect(bound(root)).toEqual({ aars: [], jars: [`${variant}-1.0.jar`] });
      }
    },
    300_000,
  );

  it.skipIf(!canRun)(
    "warn and bind no library when the app has neither a debug nor a release variant",
    () => {
      const root = app({ classpaths: ["stagingCompileClasspath"] });
      const r = lucentClasspath(root);
      expect(r.status, r.out).toBe(0);
      expect(r.out).toMatch(/no debug or release variant/);
      expect(bound(root)).toEqual({ aars: [], jars: [] });
    },
    300_000,
  );
});
