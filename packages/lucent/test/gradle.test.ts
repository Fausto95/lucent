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

/**
 * An app as lucent init leaves it: android/app/build.gradle applies Lucent's
 * Gradle task. The Android plugin is a stand-in with its id that only makes
 * the configuration lucentClasspath reads, so Gradle runs without the SDK.
 */
function app(): string {
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
    project.getConfigurations().create("debugCompileClasspath");
  }
}
`,
  );
  write(
    "app/build.gradle",
    `plugins { id "com.android.application" }\napply from: ${JSON.stringify(path.join(gradleDir, "lucent.gradle"))}\n`,
  );
  return root;
}

describe("Lucent's Gradle scripts", () => {
  it.skipIf(!jdk || !fs.existsSync(path.join(wrapper, "gradlew")))(
    "resolve the classpath the way lucent build asks, in an app that applies Lucent's Gradle task",
    () => {
      const root = app();
      // What lucent build runs (resolveAndroidDependencies).
      const r = spawnSync(
        path.join(root, "android/gradlew"),
        [
          "-q",
          "--offline",
          "--init-script",
          path.join(gradleDir, "lucent-classpath.init.gradle"),
          ":app:lucentClasspath",
        ],
        {
          cwd: path.join(root, "android"),
          encoding: "utf8",
          env: { ...process.env, JAVA_HOME: jdk },
        },
      );
      expect(r.status, r.stderr + r.stdout).toBe(0);
      expect(
        JSON.parse(fs.readFileSync(path.join(root, ".lucent/android-classpath.json"), "utf8")),
      ).toEqual({ aars: [], jars: [] });
    },
    300_000,
  );
});
