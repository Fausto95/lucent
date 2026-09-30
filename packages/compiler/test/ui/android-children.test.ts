// React children in the Android host: the rules of dev.lucent.LucentChildren
// run on the JVM (ChildrenRun.java drives them over plain views), and the
// host's Java compiled against React Native's own classes, as the app's
// build compiles it (ViewGroupManagerCheck.java).
import { androidJars } from "@lucent-lang/bindgen";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vite-plus/test";
import { runtimeDir } from "../../src/index.ts";
import { reactCommon } from "./react-native-headers.ts";

const JAVA = path.join(runtimeDir(), "native/android/src/main/java/dev/lucent");
const javac = spawnSync("javac", ["-version"]).status === 0;

/** Every step of the driver, in order. */
const EXPECTED = [
  "before mount: 11 in none, 12 in none, React Native sees 11 12",
  "mounted: slot holds 11 12",
  "reordered: 12 11, React Native sees 12 11",
  "added, removed: 12 13, 11 in none",
  "recycled: slot none, old slot holds nothing",
  "remounted: new slot holds 14",
  "pocket: slot holds 15",
  "label: 16 in none, no slot, React Native sees 16",
  "label: 16 removed, React Native sees 0",
  "reported: [lucent] Pocket's setup did not put its slot in the view it returned: its React children do not show",
  "reported: [lucent] Label takes no React children: React Native gave it 1, which it does not show",
];

/** javac's complaints about `sources` on `classpath` (Java 11, as the app's build), or "". */
function javaErrors(
  sources: readonly string[],
  classpath: readonly string[],
): { dir: string; errors: string } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lucent-android-children-"));
  const r = spawnSync(
    "javac",
    [
      "--release",
      "11",
      "-Xlint:-options",
      "-nowarn",
      ...(classpath.length ? ["-cp", classpath.join(path.delimiter)] : []),
      "-d",
      dir,
      ...sources,
    ],
    { encoding: "utf8" },
  );

  return { dir, errors: r.status === 0 ? "" : r.stderr };
}

/** The classes of the example app's React Native for Android (and fbjni), as Gradle unpacked them. */
function reactAndroidJars(): string[] | undefined {
  const version = (
    JSON.parse(fs.readFileSync(path.join(reactCommon(), "../package.json"), "utf8")) as {
      version: string;
    }
  ).version;
  const caches = path.join(os.homedir(), ".gradle/caches");
  const list = (dir: string) => (fs.existsSync(dir) ? fs.readdirSync(dir).sort() : []);
  const found = (prefix: string) => {
    for (const gradle of list(caches).toReversed())
      for (const transform of list(path.join(caches, gradle, "transforms"))) {
        const transformed = path.join(caches, gradle, "transforms", transform, "transformed");

        for (const name of list(transformed)) {
          const jar = path.join(transformed, name, "jars/classes.jar");

          if (name.startsWith(prefix) && fs.existsSync(jar)) return jar;
        }
      }

    return undefined;
  };
  // NativeMap and NativeArray are fbjni's hybrid classes.
  const jars = [found(`react-android-${version}-`), found("fbjni-")];

  return jars.every((j) => j !== undefined) ? jars : undefined;
}

describe("React children in the Android host", () => {
  it.skipIf(!javac)(
    "go in the mount's slot in React Native's order, and never elsewhere",
    () => {
      const { dir, errors } = javaErrors(
        [
          path.join(JAVA, "LucentChildren.java"),
          path.join(import.meta.dirname, "ChildrenRun.java"),
        ],
        [],
      );

      expect(errors).toBe("");

      const run = spawnSync("java", ["-cp", dir, "dev.lucent.ChildrenRun"], { encoding: "utf8" });

      expect(run.stderr).toBe("");
      expect(run.stdout.trim().split("\n")).toEqual(EXPECTED);

      fs.rmSync(dir, { recursive: true, force: true });
    },
    60_000,
  );

  const android = androidJars()?.[0];
  const react = reactAndroidJars();

  it.skipIf(!javac || !android || !react)(
    "reach it through the component's manager, which React Native mounts children with",
    () => {
      const sources = fs
        .readdirSync(JAVA)
        .filter((f) => f.endsWith(".java"))
        .map((f) => path.join(JAVA, f));
      const { dir, errors } = javaErrors(
        [...sources, path.join(import.meta.dirname, "ViewGroupManagerCheck.java")],
        [android!, ...react!],
      );

      expect(errors).toBe("");

      fs.rmSync(dir, { recursive: true, force: true });
    },
    120_000,
  );
});
