import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vite-plus/test";
import { sdkAvailable } from "@lucent-lang/bindgen";
import { classpathFile, javac, javaJar } from "../../bindgen/test/java-fixtures.ts";
import { compileKotlin, kotlinToolchain } from "../../bindgen/test/kotlin-toolchain.ts";
import { android } from "./android-harness.ts";
import { jdk, jvmRun } from "./jni-harness.ts";

/*
 * errorOf from lucent:android: an adapter around a callback API that
 * reports failure with a Throwable rejects with the Error the same
 * exception thrown by a call becomes. Run on the desktop JNI host.
 */

/** A callback API, as an app's library would have one. */
const library = {
  "dev/probe/Done.java": `package dev.probe;
public interface Done {
  void onFailure(Throwable error);
}
`,
  "dev/probe/Probe.java": `package dev.probe;
public final class Probe {
  public static void check() {
    throw new IllegalStateException("the probe broke");
  }
  public static void checkLater(Done done) {
    done.onFailure(new IllegalStateException("the probe broke"));
  }
  public static void silent(Done done) {
    done.onFailure(new UnsupportedOperationException());
  }
}
`,
};

const module = `import { errorCode, fromCallback } from "lucent:core";
import { errorOf } from "lucent:android";
import { Probe } from "lucent:android/dev.probe";

function show(err: Error): string {
  return \`\${err.name} \${errorCode(err)} \${err.message}\`;
}

export async function run(): Promise<string> {
  let thrown = "";
  try {
    Probe.check();
  } catch (e) {
    thrown = show(e as Error);
  }

  let rejected = "";
  try {
    await fromCallback<void>((_resolve, reject) => Probe.checkLater((t) => reject(errorOf(t!))));
  } catch (e) {
    rejected = show(e as Error);
  }

  // A callback that gives nothing runs later, on the Lucent thread.
  const silent = await fromCallback<string>((resolve) =>
    Probe.silent((t) => resolve(show(errorOf(t!)))),
  );

  return [thrown, rejected, String(thrown === rejected), silent].join(" | ");
}
`;

const jvm = javac && !!jdk && sdkAvailable("android");

describe.skipIf(!jvm)("errorOf from lucent:android", () => {
  it("rejects an adapter with the Error a thrown exception becomes", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "lucent-throwable-"));
    const jar = javaJar(path.join(root, "probe.jar"), library);
    const classpath = classpathFile(path.join(root, "android-classpath.json"), [jar]);
    const p = android(module, { android: { classpath } });

    expect(p.r.diagnostics).toEqual([]);
    expect(p.cpp).toContain("lucent::jni::errorOf(");
    expect(jvmRun(p.r, p.dir, [jar])).toEqual({
      status: 0,
      stdout:
        "Error java.lang.IllegalStateException the probe broke" +
        " | Error java.lang.IllegalStateException the probe broke" +
        " | true" +
        " | Error java.lang.UnsupportedOperationException java.lang.UnsupportedOperationException\n",
      stderr: "",
    });
  }, 300_000);
});

/** A Kotlin library that runs a suspend function and gives back what it threw. */
const attempt = `package dev.probe.kt

suspend fun attempt(step: suspend () -> String): Throwable? =
  try {
    step()
    null
  } catch (e: Throwable) {
    e
  }
`;

const roundTrip = `import { errorOf } from "lucent:android";
import { RunnerKt } from "lucent:android/dev.probe.kt";

export async function run(): Promise<string> {
  const original = new RangeError("out of range");
  const thrown = await RunnerKt.attempt((): string => {
    if (original.message) throw original;
    return "kept";
  });
  const back = errorOf(thrown!);

  return \`\${back === original} \${back.name} \${back.message}\`;
}
`;

const tc = kotlinToolchain();
const coroutines = tc && path.join(tc.lib, "kotlinx-coroutines-core-jvm.jar");
const kotlin =
  !!tc && !!coroutines && fs.existsSync(coroutines) && !!jdk && sdkAvailable("android");

describe.skipIf(!kotlin)("errorOf of a Lucent error Kotlin caught", () => {
  it("is the error itself: thrown to Kotlin by a suspend function, read back", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "lucent-throwable-kt-"));
    const source = path.join(root, "Runner.kt");
    fs.writeFileSync(source, attempt);
    const lib = await compileKotlin(tc!, [source], path.join(root, "runner.jar"), {
      classpath: coroutines!,
    });
    const jars = [path.join(tc!.lib, "kotlin-stdlib.jar"), coroutines!, lib];
    const classpath = classpathFile(path.join(root, "android-classpath.json"), jars);
    const p = android(roundTrip, { android: { classpath } });

    expect(p.r.diagnostics).toEqual([]);
    expect(jvmRun(p.r, p.dir, jars, tc!)).toEqual({
      status: 0,
      stdout: "true RangeError out of range\n",
      stderr: "",
    });
  }, 600_000);
});
