import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vite-plus/test";
import { classpathFile, javaJar } from "../../bindgen/test/java-fixtures.ts";
import { android } from "./android-harness.ts";
import { fakeAndroid } from "./fake-android.ts";
import { jdk, jvmRun } from "./jni-harness.ts";

/*
 * nativeError from lucent:android: the Java exception a Lucent error came
 * from, so code tests its class with instanceof and reads its members,
 * instead of matching the class name in `code`. Run on the desktop JNI
 * host against the JDK's classes.
 */

const library = {
  "dev/probe/Probe.java": `package dev.probe;
public final class Probe {
  public static void check() {
    throw new IllegalStateException("the probe broke");
  }
  public static void read(String path) throws java.io.IOException {
    throw new java.io.FileNotFoundException(path);
  }
}
`,
};

const module = `import { errorCode } from "lucent:core";
import { errorOf, nativeError } from "lucent:android";
import { Probe } from "lucent:android/dev.probe";
import { IllegalStateException, RuntimeException } from "lucent:android/java.lang";
import { FileNotFoundException, IOException } from "lucent:android/java.io";

export async function run(): Promise<string> {
  const out: string[] = [];
  try {
    Probe.check();
  } catch (e) {
    const t = nativeError(e as Error);
    out.push(\`\${t instanceof IllegalStateException} \${t instanceof RuntimeException} \${t?.getMessage()}\`);
    // The exception, read again, makes the same error.
    const again = t ? errorOf(t) : undefined;
    out.push(\`\${again?.message === (e as Error).message} \${errorCode(e as Error)}\`);
  }
  try {
    Probe.read("/missing");
  } catch (e) {
    const t = nativeError(e as Error);
    out.push(\`\${t instanceof FileNotFoundException} \${t instanceof IOException} \${t?.getMessage()}\`);
  }
  out.push(\`\${nativeError(new Error("made here")) === null}\`);
  return out.join(" | ");
}
`;

const fake = fakeAndroid(fs.mkdtempSync(path.join(os.tmpdir(), "lucent-native-errors-")), {});

describe.skipIf(!fake || !jdk)("nativeError from lucent:android", () => {
  it("gives back the exception an error came from", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "lucent-native-errors-"));
    const jar = javaJar(path.join(root, "probe.jar"), library);
    const classpath = classpathFile(path.join(root, "android-classpath.json"), [jar]);
    const p = android(module, { android: { jars: fake!.bind, classpath } });

    expect(p.r.diagnostics).toEqual([]);
    expect(jvmRun(p.r, p.dir, [jar, ...fake!.run])).toEqual({
      status: 0,
      stdout:
        "true true the probe broke" +
        " | true java.lang.IllegalStateException" +
        " | true true /missing" +
        " | true\n",
      stderr: "",
    });
  }, 300_000);
});
