/**
 * An Android SDK for hosts without one, in tests: the JDK's own java.*
 * classes, which android.jar declares too, and stand-ins for the Android
 * classes a test uses. Bound like android.jar, and run on the desktop JNI
 * host (jni-harness.ts), they let Android platform code compile and run on
 * Linux.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { javac, javaJar } from "../../bindgen/test/java-fixtures.ts";
import { runJar } from "../../bindgen/test/jvm-tools.ts";
import { jdk } from "./jni-harness.ts";

/** The JDK's java.* classes as a jar (built once per JDK), or undefined without a JDK's jmods. */
function javaBase(): string | undefined {
  const home = jdk?.home;
  const jmod = home && path.join(home, "jmods/java.base.jmod");
  if (!home || !jmod || !fs.existsSync(jmod) || !javac) return undefined;

  const id = `${fs.statSync(jmod).size}-${Math.floor(fs.statSync(jmod).mtimeMs)}`;
  const jar = path.join(os.tmpdir(), `lucent-java-base-${id}.jar`);
  if (fs.existsSync(jar)) return jar;

  const work = fs.mkdtempSync(path.join(os.tmpdir(), "lucent-java-base-"));
  const x = spawnSync(path.join(home, "bin/jmod"), ["extract", "--dir", work, jmod], {
    encoding: "utf8",
  });
  if (x.status !== 0) return undefined;

  const tmp = `${jar}.${process.pid}`;
  runJar(["cf", tmp, "-C", path.join(work, "classes"), "java"]);
  fs.renameSync(tmp, jar);
  fs.rmSync(work, { recursive: true, force: true });

  return jar;
}

/**
 * Jars standing for android.jar: `bind`, what bindings read (java.* and
 * the stand-ins), and `run`, what the JVM adds to its classpath (the
 * stand-ins). Undefined when this host has no JDK to build them with.
 */
export function fakeAndroid(
  dir: string,
  sources: Record<string, string>,
): { bind: string[]; run: string[] } | undefined {
  const base = javaBase();
  if (!base) return undefined;

  const standIns = javaJar(path.join(dir, "android-stand-ins.jar"), sources);
  return { bind: [base, standIns], run: [standIns] };
}
