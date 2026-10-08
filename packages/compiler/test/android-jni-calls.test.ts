import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vite-plus/test";
import { classpathFile, javac, javaJar } from "../../bindgen/test/java-fixtures.ts";
import { android } from "./android-harness.ts";
import { jdk, jvmRun } from "./jni-harness.ts";

/*
 * The JNI each SDK call site compiles to, run on the desktop JNI host
 * against a library's jar (the Android SDK is not needed: a stand-in
 * android.jar is). A call site's class and member IDs are looked up once
 * (statics), a class passed as an argument too, and the call goes through
 * the runtime's call templates rather than code of its own.
 */

const library = {
  "dev/probe/Probe.java": `package dev.probe;
public final class Probe {
  public static int made = 0;
  public int count = 0;
  public Probe() { made++; }
  public static int twice(int x) { return x * 2; }
  public static String join(String a, String b) { return a + b; }
  public static <T> T make(Class<T> c) throws Exception { return c.getDeclaredConstructor().newInstance(); }
  public void bump() { count++; }
  public long total(long by) { count += (int) by; return count; }
}
`,
};

const module = `import { Probe } from "lucent:android/dev.probe";

export async function run(): Promise<string> {
  const p = new Probe();
  for (let i = 0; i < 3; i++) p.bump();
  let made = 0;
  for (let i = 0; i < 4; i++) made += Probe.make(Probe)!.count;
  return [Probe.twice(21), Probe.join("a", "b"), p.count, p.total(2n), made, Probe.made].join(" ");
}
`;

describe.skipIf(!javac || !jdk)("SDK call sites over JNI", () => {
  const root = javac ? fs.mkdtempSync(path.join(os.tmpdir(), "lucent-jni-calls-")) : "";
  const jar = javac ? javaJar(path.join(root, "probe.jar"), library) : "";
  // What android.jar would give: here, nothing the module uses.
  const sdk = javac
    ? javaJar(path.join(root, "android.jar"), {
        "android/Stand.java": "package android;\npublic final class Stand {}\n",
      })
    : "";
  const compiled = () =>
    android(module, {
      android: { classpath: classpathFile(path.join(root, "cp.json"), [jar]), jars: [sdk] },
    });

  it("looks a class passed as an argument up once, and calls through the runtime's templates", () => {
    const p = compiled();

    expect(p.r.diagnostics).toEqual([]);

    // The class argument is a static of the call site, as its own class is.
    expect(p.cpp).toMatch(/static jclass arg\d+_ = lucent::jni::findClass\("dev\/probe\/Probe"\);/);
    expect(p.cpp).not.toMatch(/, lucent::jni::findClass\(/);
    // No lambda per call site: the runtime's call templates.
    expect(p.cpp).not.toContain("[&]() -> ");
    expect(p.cpp).toContain("lucent::jni::callStatic<jint>(");
  });

  it("gives what the JVM computes", () => {
    const p = compiled();

    expect(jvmRun(p.r, p.dir, [jar])).toEqual({
      status: 0,
      stdout: "42 ab 3 5 0 5\n",
      stderr: "",
    });
  }, 300_000);
});
