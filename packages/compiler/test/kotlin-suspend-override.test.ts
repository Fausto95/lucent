import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vite-plus/test";
import { classpathFile } from "../../bindgen/test/java-fixtures.ts";
import { compileKotlin, kotlinToolchain } from "../../bindgen/test/kotlin-toolchain.ts";
import { android } from "./android-harness.ts";
import { fakeAndroid } from "./fake-android.ts";
import { jdk, jvmRun } from "./jni-harness.ts";

/*
 * A Lucent `async` method overriding a Kotlin class's `suspend` member, as
 * CoroutineWorker.doWork is (T112): the Java subclass's override takes the
 * continuation, and Kotlin is told the call suspended until the promise
 * settles. Run on the desktop JNI host, with Kotlin's standard library's
 * coroutines alone.
 */

const library = `package dev.probe.kt

import kotlin.coroutines.Continuation
import kotlin.coroutines.EmptyCoroutineContext
import kotlin.coroutines.startCoroutine

abstract class Worker {
  abstract suspend fun work(input: String): String
  open suspend fun twice(input: String): String = work(input) + work(input)
}

object Driver {
  @Volatile private var result: String? = null

  @JvmStatic fun start(worker: Worker, input: String) {
    result = null
    suspend { worker.twice(input) }.startCoroutine(Continuation(EmptyCoroutineContext) { r ->
      result = r.fold({ "done: " + it }, { "failed: " + it.javaClass.simpleName + " " + it.message })
    })
  }

  @JvmStatic fun result(): String? = result
}
`;

const module = `import { Driver, Worker } from "lucent:android/dev.probe.kt";
import { delay } from "lucent:core";

class Echo extends Worker {
  async work(input: string): Promise<string> {
    await delay(5);
    if (input === "bad") throw new RangeError("no bad input");
    return input.toUpperCase();
  }
}

async function outcome(input: string): Promise<string> {
  Driver.start(new Echo(), input);
  for (let i = 0; i < 300 && Driver.result() === null; i++) await delay(10);
  return Driver.result() ?? "never resumed";
}

export async function run(): Promise<string> {
  return \`\${await outcome("hi")} | \${await outcome("bad")}\`;
}
`;

const tc = kotlinToolchain();
const fake = fakeAndroid(fs.mkdtempSync(path.join(os.tmpdir(), "lucent-suspend-")), {});

describe.skipIf(!tc || !fake || !jdk)("an async method overriding a Kotlin suspend member", () => {
  it("is what Kotlin's coroutine waits for, its value or its error", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "lucent-suspend-"));
    const source = path.join(root, "Worker.kt");
    fs.writeFileSync(source, library);
    const lib = await compileKotlin(tc!, [source], path.join(root, "worker.jar"));
    const jars = [path.join(tc!.lib, "kotlin-stdlib.jar"), lib];
    const classpath = classpathFile(path.join(root, "android-classpath.json"), jars);
    const p = android(module, { android: { jars: fake!.bind, classpath } });

    expect(p.r.diagnostics.map((d) => d.message)).toEqual([]);
    expect(jvmRun(p.r, p.dir, [...jars, ...fake!.run], tc!)).toEqual({
      status: 0,
      stdout: "done: HIHI | failed: RuntimeException no bad input\n",
      stderr: "",
    });
  }, 600_000);
});
