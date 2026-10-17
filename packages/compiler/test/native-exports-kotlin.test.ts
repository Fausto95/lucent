/**
 * The Kotlin API native code calls a module's exports through (decision
 * 0116): top-level functions, wrapper classes of exported classes, `suspend`
 * functions for async exports, and LucentException for what Lucent code
 * throws. Kotlin calls them on the desktop JNI host, through the natives the
 * Android entries unit adds.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vite-plus/test";
import { kotlinToolchain } from "../../bindgen/test/kotlin-toolchain.ts";
import { compile } from "../src/index.ts";
import { fakeAndroid } from "./fake-android.ts";
import { jdk, jvmRun } from "./jni-harness.ts";

// Branching on the platform, it compiles for Android apart: the harness runs Android's files.
const module = `import { PLATFORM } from "lucent:platform";

export function os(): string {
  return PLATFORM;
}

export class Counter {
  count = 0;
  private total = 0;
  static created = 0;

  constructor(start: number) {
    this.total = start;
    Counter.created++;
  }

  get value(): number {
    return this.total;
  }

  set value(v: number) {
    this.total = v;
  }

  increment(by: number): number {
    this.count++;
    this.total += by;
    return this.total;
  }

  async settle(): Promise<string> {
    await Promise.resolve();
    return "settled at " + this.total;
  }

  async reset(): Promise<void> {
    await Promise.resolve();
    this.total = 0;
  }

  static make(): Counter {
    return new Counter(100);
  }
}

export class Labelled extends Counter {
  constructor(public label: string) {
    super(1);
  }

  increment(by: number): number {
    return super.increment(by * 10);
  }
}

export function sum(cs: Counter[]): number {
  let n = 0;
  for (const c of cs) n += c.value;
  return n;
}

export function describe(c: Counter | null): string {
  return c === null ? "none" : "a counter of " + c.value;
}

export function tags(r: Record<string, number>): string[] {
  return Object.keys(r).map((k) => k + "=" + r[k]);
}

export function greet(name: string): string {
  if (name === "") throw new RangeError("no name");
  return "hi " + name;
}

export async function later(n: number): Promise<string> {
  await Promise.resolve();
  return "later " + n;
}

let rests = 0;

export async function rest(): Promise<void> {
  await Promise.resolve();
  rests++;
}

let busy = false;
let turns = 0;

/** Throws when another call is running: calls from several threads take turns. */
export function take(spins: number): number {
  if (busy) throw new Error("overlapped");
  busy = true;
  let x = 0;
  for (let i = 0; i < spins; i++) x += i % 7;
  busy = false;
  turns++;
  return x;
}

export function taken(): number {
  return turns;
}
`;

/** Kotlin calling the module, as an app's or a library's would. */
const probe = `package probe

import dev.lucent.LucentException
import dev.lucent.app.counters.Counter
import dev.lucent.app.counters.Labelled
import dev.lucent.app.counters.describe
import dev.lucent.app.counters.greet
import dev.lucent.app.counters.later
import dev.lucent.app.counters.rest
import dev.lucent.app.counters.sum
import dev.lucent.app.counters.tags
import dev.lucent.app.counters.take
import dev.lucent.app.counters.taken
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger
import kotlin.coroutines.Continuation
import kotlin.coroutines.EmptyCoroutineContext
import kotlin.coroutines.startCoroutine

object Probe {
  private fun <T> await(block: suspend () -> T): String {
    var out = "never settled"
    val latch = CountDownLatch(1)
    block.startCoroutine(Continuation(EmptyCoroutineContext) { r ->
      out = r.fold({ it.toString() }, { "failed: " + it })
      latch.countDown()
    })
    latch.await(5, TimeUnit.SECONDS)
    return out
  }

  @JvmStatic fun run(): String {
    val lines = mutableListOf<String>()
    val c = Counter(1.0)
    lines += "increment " + c.increment(2.0)
    c.value = 10.0
    lines += "value " + c.value + ", count " + c.count + ", created " + Counter.created
    val made = Counter.make()
    lines += "sum " + sum(listOf(c, made)) + ", " + describe(null) + ", " + describe(made)
    lines += "tags " + tags(linkedMapOf("b" to 2.0, "a" to 1.0))
    val l = Labelled("x")
    lines += "labelled " + l.increment(2.0) + " " + l.label + " " + (sum(listOf(l)))
    try {
      greet("")
    } catch (e: LucentException) {
      lines += "threw " + e.name + ": " + e.message
    }
    lines += "await " + await { later(4.0) } + ", " + await { c.settle() }
    // An async function or method that gives nothing: Unit.
    lines += "await void " + await { rest() } + ", " + await { c.reset() } + ", value " + c.value
    // Threads call at once: each call holds the module's actor.
    val overlapped = AtomicInteger()
    val threads = (1..8).map {
      Thread {
        repeat(25) {
          try {
            take(20000.0)
          } catch (e: LucentException) {
            overlapped.incrementAndGet()
          }
        }
      }
    }
    threads.forEach { it.start() }
    threads.forEach { it.join() }
    lines += "turns " + taken() + ", " + overlapped.get() + " overlapped"
    c.close()
    try {
      c.increment(1.0)
    } catch (e: LucentException) {
      lines += "closed " + e.name
    }
    made.close()
    l.close()
    return lines.joinToString("\\n")
  }
}
`;

const main = `#include <cstdio>

#include "jni_host.h"
#include "lucent_entries.h"
#include <lucent/native_root.h>
#include <lucent/platform/android.h>

extern "C" void lucent_entries_register_natives(JNIEnv* env);

int main(int, char** argv) {
  lucentStartJvm(argv[1]);
  JNIEnv* env = lucent::jni::env();
  lucent::jni::installNatives(env);
  lucent_entries_register_natives(env);
  jclass probe = env->FindClass("probe/Probe");
  jmethodID run = env->GetStaticMethodID(probe, "run", "()Ljava/lang/String;");
  auto out = static_cast<jstring>(env->CallStaticObjectMethod(probe, run));
  if (env->ExceptionCheck()) {
    env->ExceptionDescribe();
    return 1;
  }
  const char* text = env->GetStringUTFChars(out, nullptr);
  std::printf("%s\\nholds %d\\n", text, (int)lucent::moduleStateHolds());
  env->ReleaseStringUTFChars(out, text);
  return 0;
}
`;

const tc = kotlinToolchain();
const fake = fakeAndroid(fs.mkdtempSync(path.join(os.tmpdir(), "lucent-exports-kt-")), {});

describe.skipIf(!tc || !fake || !jdk)("the Kotlin API of a module's exports", () => {
  it("calls functions, makes and uses instances, awaits, and catches what Lucent throws", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lucent-exports-kt-"));
    fs.writeFileSync(path.join(dir, "counters.lucent.ts"), module);
    const r = compile([path.join(dir, "counters.lucent.ts")], {
      platforms: ["android"],
      sdk: { android: { jars: fake!.bind } },
    });
    expect(r.diagnostics.map((d) => d.message)).toEqual([]);

    const exports = r.kotlin!.get("dev/lucent/app/counters/Exports.kt")!;
    expect(exports).toContain('@file:JvmName("Exports")');
    expect(exports).toContain("fun sum(cs: List<dev.lucent.app.counters.Counter>): Double {");
    expect(exports).toContain("suspend fun later(n: Double): String {");
    const counter = r.kotlin!.get("dev/lucent/app/counters/Counter.kt")!;
    expect(counter).toContain(
      "open class Counter internal constructor(handle: Long) : dev.lucent.LucentInstance(handle) {",
    );
    expect(r.kotlin!.get("dev/lucent/app/counters/Labelled.kt")).toContain(
      "override fun increment(by: Double): Double {",
    );

    const program = { ...r, kotlin: new Map([...r.kotlin!, ["probe/Probe.kt", probe]]) };
    const stdlib = path.join(tc!.lib, "kotlin-stdlib.jar");
    expect(jvmRun(program, dir, [stdlib, ...fake!.run], tc!, main, true)).toEqual({
      status: 0,
      stdout: [
        "increment 3.0",
        "value 10.0, count 1.0, created 1.0",
        "sum 110.0, none, a counter of 100",
        "tags [b=2, a=1]",
        "labelled 21.0 x 21.0",
        "threw RangeError: no name",
        "await later 4, settled at 10",
        "await void kotlin.Unit, kotlin.Unit, value 0.0",
        "turns 200.0, 0 overlapped",
        "closed TypeError",
        "holds 0",
        "",
      ].join("\n"),
      stderr: "",
    });
  }, 600_000);
});
