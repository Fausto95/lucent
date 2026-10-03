import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { runJar, runJavac } from "./jvm-tools.ts";

export const javac =
  spawnSync("javac", ["-version"]).status === 0 && spawnSync("jar", ["--version"]).status === 0;

/**
 * Compiles Java sources (path in the package tree → source) into `jar`,
 * against `classpath` for what they reference; returns the jar.
 */
export function javaJar(jar: string, sources: Record<string, string>, classpath: string[] = []) {
  const dir = `${jar}.build`;
  const src = path.join(dir, "src");
  const classes = path.join(dir, "classes");

  const files = Object.entries(sources).map(([file, text]) => {
    const full = path.join(src, file);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, text);
    return full;
  });

  const cp = classpath.length ? ["-cp", classpath.join(path.delimiter)] : [];
  const cc = runJavac(["--release", "11", ...cp, "-d", classes, ...files]);
  if (cc.status !== 0) throw new Error(cc.stderr);

  fs.mkdirSync(path.dirname(jar), { recursive: true });
  runJar(["cf", jar, "-C", classes, "."]);
  fs.rmSync(dir, { recursive: true, force: true });

  return jar;
}

/** Where Gradle keeps a Maven artifact's file: `files-2.1/<group>/<name>/<version>/<hash>/<file>`. */
export const gradleCached = (root: string, group: string, name: string, version: string) =>
  path.join(root, "files-2.1", group, name, version, "0a1b2c", `${name}-${version}.jar`);

/** An Android SDK with one platform whose android.jar holds `sources`; returns the SDK root. */
export function fakeAndroidSdk(root: string, platform: string, sources: Record<string, string>) {
  javaJar(path.join(root, "platforms", platform, "android.jar"), sources);
  return root;
}

/** The app's resolved classpath, as the lucentClasspath Gradle task writes it. */
export function classpathFile(file: string, jars: string[], aars: string[] = []): string {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify({ aars, jars }));
  return file;
}
