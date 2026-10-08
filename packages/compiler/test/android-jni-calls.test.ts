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
 * (statics), and a class passed as an argument too.
 *
 * Each call site stays a lambda of its own: its receiver is evaluated
 * before its local frame is pushed and its arguments inside it, which a
 * function template's arguments would not be (their local references
 * would outlive the call). Its environment, frame, class and member are
 * one line, LUCENT_JNI_SITE, which expands to them in that order. See
 * ROADMAP.md's decisions log.
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

  it("looks a class passed as an argument up once per call site", () => {
    const p = compiled();

    expect(p.r.diagnostics).toEqual([]);

    // The class argument is a static of its use, as the call site's own class is.
    expect(p.cpp).toContain('LUCENT_JNI_CLASS("dev/probe/Probe")');
    expect(p.cpp).not.toMatch(/, lucent::jni::findClass\(/);
  });

  it("starts each call site with one line: its environment, frame, class and member", () => {
    const p = compiled();
    const run = p.cpp.slice(p.cpp.indexOf("::run()"));

    expect(run).toContain('LUCENT_JNI_SITE(method, "dev/probe/Probe", "bump", "()V");');
    expect(run).toContain('LUCENT_JNI_SITE(staticMethod, "dev/probe/Probe", "twice", "(I)I");');
    expect(run).not.toContain("LocalFrame");
    // The receiver is read before the frame is pushed, the arguments inside it.
    expect(run).toMatch(
      /auto recv_ = p;\n(#line .*\n)?\s*LUCENT_JNI_SITE\(method, "dev\/probe\/Probe", "total"/,
    );
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
